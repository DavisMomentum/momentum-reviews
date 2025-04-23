const { MongoClient } = require('mongodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
const bucketName = process.env.BUCKET_NAME;

exports.handler = async (event) => {
    try {
        await client.connect();
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
            if (!contentType.includes('multipart/form-data')) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Content-Type must be multipart/form-data' })
                };
            }

            const boundary = contentType.split('boundary=')[1];
            const parts = parseMultipartFormData(event.body, boundary);

            const name = parts.name?.value;
            const rating = parseInt(parts.rating?.value);
            const comment = parts.comment?.value;
            const file = parts.video;

            let videoUrl = null;
            if (file) {
                const fileName = `${Date.now()}-${file.filename}`;
                const command = new PutObjectCommand({
                    Bucket: bucketName,
                    Key: fileName,
                    Body: Buffer.from(file.content, 'base64'),
                    ContentType: file.contentType
                });

                await s3Client.send(command);
                videoUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
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
        const content = contentParts.join('\r\n\r\n').trim();
        const disposition = header.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/);
        const contentType = header.match(/Content-Type: (.*)/);

        const name = disposition[1];
        const filename = disposition[2];
        if (filename) {
            parts[name] = {
                filename,
                contentType: contentType ? contentType[1] : 'application/octet-stream',
                content: Buffer.from(content, 'base64')
            };
        } else {
            parts[name] = { value: content };
        }
    }

    return parts;
}
