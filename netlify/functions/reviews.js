const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { handler: netlifyHandler, builder } = require('@netlify/functions');
const { parseMultipartFormData } = require('@netlify/functions');

const s3Client = new S3Client({
    region: process.env.MY_AWS_REGION || 'us-east-2',
    credentials: {
        accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY
    }
});

const bucketName = process.env.BUCKET_NAME || 'momentum-solar-reviews-davis';
if (!bucketName) {
    throw new Error('BUCKET_NAME environment variable is not set');
}

const reviewSchema = new mongoose.Schema({
    name: String,
    rating: Number,
    comment: String,
    videoUrl: String,
    createdAt: { type: Date, default: Date.now }
});

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

const connectToMongoDB = async () => {
    if (mongoose.connection.readyState === 0) {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('MongoDB connected successfully');
    }
};

const handler = async (event) => {
    try {
        if (event.httpMethod === 'GET') {
            await connectToMongoDB();
            const reviews = await Review.find().sort({ createdAt: -1 });
            return {
                statusCode: 200,
                body: JSON.stringify(reviews)
            };
        }

        if (event.httpMethod !== 'POST') {
            return {
                statusCode: 405,
                body: JSON.stringify({ error: 'Method Not Allowed' })
            };
        }

        console.log('Content-Type:', event.headers['content-type']);
        const boundary = event.headers['content-type'].split('boundary=')[1];
        console.log('Boundary:', boundary);

        console.log('Parsing multipart form data...');
        const parsedData = await parseMultipartFormData(event);
        console.log('Parsed data:', parsedData);

        const fields = parsedData.fields || {};
        const files = parsedData.files || [];

        const name = fields.name?.[0];
        const rating = parseInt(fields.rating?.[0], 10);
        const comment = fields.comment?.[0];
        const videoFile = files.find(file => file.name === 'video');

        console.log('Extracted fields:', { name, rating, comment });
        console.log('Extracted video file:', videoFile ? videoFile.filename : 'No video file');

        if (!name || !rating || !comment) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        await connectToMongoDB();

        let videoUrl = null;
        if (videoFile) {
            console.log('Uploading video to S3...');
            const timestamp = Date.now();
            const key = `${timestamp}-${videoFile.filename}`;
            const uploadParams = {
                Bucket: bucketName,
                Key: key,
                Body: videoFile.content,
                ContentType: videoFile.contentType
            };

            try {
                const command = new PutObjectCommand(uploadParams);
                await s3Client.send(command);
                videoUrl = `https://${bucketName}.s3.${process.env.MY_AWS_REGION || 'us-east-2'}.amazonaws.com/${key}`;
                console.log('Video uploaded successfully:', videoUrl);
            } catch (s3Error) {
                console.error('S3 upload error:', s3Error.message);
                throw new Error(`Failed to upload video to S3: ${s3Error.message}`);
            }
        }

        const review = new Review({
            name,
            rating,
            comment,
            videoUrl
        });

        console.log('Saving review to MongoDB...');
        await review.save();
        console.log('Review saved successfully');

        return {
            statusCode: 201,
            body: JSON.stringify({ message: 'Review submitted successfully', review })
        };
    } catch (error) {
        console.error('Error in handler:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error', details: error.message })
        };
    }
};

exports.handler = builder(handler);
