const express = require('express');
const { MongoClient } = require('mongodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const cors = require('cors');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// MongoDB setup
const uri = process.env.MONGODB_URI;
if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
}
const client = new MongoClient(uri);

// S3 setup
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
const bucketName = process.env.BUCKET_NAME;

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit, added previously
});

// Middleware
app.use(cors());
app.use(express.json());

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

// GET reviews
app.get('/reviews', async (req, res) => {
    try {
        const db = client.db('momentum-reviews');
        const reviews = db.collection('reviews');
        const reviewList = await reviews.find({}).toArray();
        res.status(200).json(reviewList);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// POST reviews
app.post('/reviews', upload.single('video'), async (req, res) => {
    try {
        console.log('Received body:', req.body);
        console.log('Received file:', req.file);
        const db = client.db('momentum-reviews');
        const reviews = db.collection('reviews');
        const { name, rating, comment } = req.body;
        let videoUrl = null;

        if (req.file) {
            const fileName = `${Date.now()}-${req.file.originalname}`;
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: fileName,
                Body: req.file.buffer,
                ContentType: req.file.mimetype,
            });

            await s3Client.send(command);
            videoUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
        }

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
        res.status(500).json({ error: 'Failed to submit review', details: error.message });
    }
});

// Start the server
app.listen(port, async () => {
    await connectToMongo();
    console.log(`Server running on port ${port}`);
});
});
