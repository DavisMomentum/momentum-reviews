const { MongoClient } = require('mongodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto'); // Add this import for SHA256 hashing

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

const s3Client = new S3Client({
    region: process.env.MY_AWS_REGION,
    credentials: {
        accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const bucketName = process.env.BUCKET_NAME;
console.log('BUCKET_NAME from env:', process.env.BUCKET_NAME);
console.log('bucketName:', bucketName);

if (!bucketName) {
    throw new Error('BUCKET_NAME environment variable is not set');
}

exports.handler = async (event) => {
    try {
        console.log('Attempting to connect to MongoDB...');
        await client.connect();
        console.log('MongoDB connected successfully');
        const db = client.db('momentum-reviews');
        const reviews = db.collection('reviews');

        if (event.httpMethod === 'GET') {
            const reviewList = await reviews.find({}).toArray();
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reviewList)
            };
        }

        if (event.httpMethod === 'POST') {
            const contentType = event.headers['content-type'] || '';
            console.log('Content-Type:', contentType);
            if (!contentType.includes('multipart/form-data')) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Content-Type must be multipart/form-data' })
                };
            }

            const boundary = contentType.split('boundary=')[1];
            console.log('Boundary:', boundary);

            // Decode the body if it's base64-encoded
            const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
            console.log('Decoded body:', body);

            const parts = parseMultipartFormData(body, boundary);
            console.log('Parsed parts:', parts);

            const name = parts.name?.value;
            const rating = parseInt(parts.rating?.value);
            const comment = parts.comment?.value;
            const file = parts.video;

            let videoUrl = null;
            if (file) {
                const fileName = `${Date.now()}-${file.filename}`;
                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Body: file.content, // Already a Buffer, no need for Buffer.from(file.content, 'base64')
                    ContentType: file.contentType
                };

                // Add logging for S3 upload params
                console.log('S3 Upload Params:', {
                    Bucket: params.Bucket,
                    Key: params.Key,
                    ContentType: params.ContentType,
                    BodyLength: params.Body.length, // Log the byte length of the Body
                    BodyHash: crypto.createHash('sha256').update(params.Body).digest('hex'), // Compute SHA256 hash
                });

                const command = new PutObjectCommand(params);
                try {
                    await s3Client.send(command);
                    videoUrl = `https://${bucketName}.s3.${process.env.MY_AWS_REGION}.amazonaws.com/${fileName}`;
                } catch (s3Error) {
                    console.error('S3 Upload Error:', s3Error);
                    throw new Error(`Failed to upload file to S3: ${s3Error.message}`);
                }
            }

            const review = {
                name,
                rating,
                comment,
                videoUrl,
                createdAt: new Date()
            };

            await reviews.insertOne(review);
            return {
                statusCode: 201,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Review submitted successfully', review })
            };
        }

        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process request', details: error.message })
        };
    } finally {
        await client.close();
    }
};

function parseMultipartFormData(body, boundary) {
    const parts = {};
    const rawParts = body.split(`--${boundary}`).filter(part => part.trim() && !part.includes('--'));

    for (const part of rawParts) {
        const [header, ...contentParts] = part.split('\r\n\r\n');
        if (!header || !contentParts.length) {
            console.log('Skipping malformed part:', part);
            continue;
        }

        const content = contentParts.join('\r\n\r\n').trim();
        const dispositionMatch = header.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/);
        if (!dispositionMatch) {
            console.log('No Content-Disposition match in header:', header);
            continue;
        }

        const contentTypeMatch = header.match(/Content-Type: (.*)/);

        const name = dispositionMatch[1];
        const filename = dispositionMatch[2];
        if (filename) {
            parts[name] = {
                filename,
                contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
                content: Buffer.from(content, 'base64') // This is already handled correctly
            };
        } else {
            parts[name] = { value: content };
        }
    }

    return parts;
}
