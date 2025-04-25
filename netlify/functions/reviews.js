const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const { parseMultipartFormData } = require('@netlify/functions');

const s3Client = new S3Client({
    region: process.env.MY_AWS_REGION,
    credentials: {
        accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const bucketName = process.env.BUCKET_NAME;
console.log('MY_AWS_REGION:', process.env.MY_AWS_REGION);
console.log('MY_AWS_ACCESS_KEY_ID:', process.env.MY_AWS_ACCESS_KEY_ID);
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '[REDACTED]' : 'NOT SET');
console.log('BUCKET_NAME:', process.env.BUCKET_NAME);
if (!bucketName) {
    throw new Error('BUCKET_NAME environment variable is not set');
}

const reviewSchema = new mongoose.Schema({
    name: String,
    rating: Number,
    comment: String,
    videoUrl: String,
    timestamp: { type: Date, default: Date.now }
});

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

const connectToMongoDB = async () => {
    if (mongoose.connection.readyState === 0) {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('MongoDB connected successfully');
    }
};

exports.handler = async (event) => {
    try {
        // Handle GET request to fetch reviews
        if (event.httpMethod === 'GET') {
            await connectToMongoDB();
            const reviews = await Review.find().sort({ timestamp: -1 });
            return {
                statusCode: 200,
                body: JSON.stringify(reviews)
            };
        }

        // Handle POST request to submit a review
        if (event.httpMethod !== 'POST') {
            return {
                statusCode: 405,
                body: JSON.stringify({ error: 'Method Not Allowed' })
            };
        }

        console.log('Content-Type:', event.headers['content-type']);
        const boundary = event.headers['content-type'].split('boundary=')[1];
        console.log('Boundary:', boundary);

        // Parse the multipart form data
        console.log('Parsing multipart form data...');
        const parsedData = await parseMultipartFormData(event);
        console.log('Parsed data:', parsedData);

        // Extract fields and files
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
                videoUrl = `https://${bucketName}.s3.${process.env.MY_AWS_REGION}.amazonaws.com/${key}`;
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
