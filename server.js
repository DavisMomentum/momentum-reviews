const express = require('express');
const { MongoClient } = require('mongodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// MongoDB setup
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

// S3 setup using environment variables
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
const bucketName = process.env.BUCKET_NAME || 'momentum-solar-reviews-davis';

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(cors()); // Enable CORS for front-end requests
app.use(express.json());
app.use(express.static(path.join(__dirname, '.'))); // Serve static files (e.g., index.html)

// Connect to MongoDB
async function connectToMongo() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

// Route to handle review submission with video
app.post('/reviews', upload.single('video'), async (req, res) => {
    try {
        const db = client.db('momentum-reviews');
        const reviews = db.collection('reviews');

        const { name, rating, comment } = req.body;
        let videoUrl = null;

        // If a video file is uploaded, upload it to S3
        if (req.file) {
            const fileName = `${Date.now()}-${req.file.originalname}`;
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: fileName,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            });

            await s3Client.send(command);
            videoUrl = `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-2'}.amazonaws.com/${fileName}`;
        }

        // Save review to MongoDB
        const review = {
            name,
            rating: parseInt(rating),
            comment,
            videoUrl,
            createdAt: new Date()
        };

        await reviews.insertOne(review);
        res.status(201).json({ message: 'Review submitted successfully', review });
    } catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).json({ error: 'Failed to submit review' });
    }
});

// Route to get all reviews
app.get('/reviews', async (req, res) => {
    try {
        const db = client.db('momentum-reviews');
        const reviews = db.collection('reviews');
        const reviewList = await reviews.find().toArray();
        res.status(200).json(reviewList);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// Start the server
app.listen(port, async () => {
    await connectToMongo();
    console.log(`Server running on port ${port}`);
});