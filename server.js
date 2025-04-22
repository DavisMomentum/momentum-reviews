const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// MongoDB connection
const uri = 'mongodb+srv://DataBase:SolarReviews2025@momentumreviews.crqqpoq.mongodb.net/momentum-reviews?retryWrites=true&w=majority';
const client = new MongoClient(uri);
let db;

async function connectToMongo() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        db = client.db('momentum-reviews');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

// AWS S3 configuration (v3)
const { S3Client } = require("@aws-sdk/client-s3");
const s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-2",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
const bucketName = process.env.BUCKET_NAME || "momentum-solar-reviews-davis";

// Multer configuration for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint to save a review with file upload
app.post('/reviews', upload.single('media'), async (req, res) => {
    try {
        console.log('Received review data:', req.body);
        console.log('Received file:', req.file);

        const { name, text, mediaType } = req.body;
        let mediaUrl = '';

        if (req.file) {
            const file = req.file;
            const fileName = `${Date.now()}-${file.originalname}`;
            console.log('Uploading file to S3:', fileName, 'Type:', file.mimetype);

            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: fileName,
                Body: file.buffer,
                ContentType: file.mimetype
            });

            try {
                await s3Client.send(command);
                mediaUrl = `https://${bucketName}.s3.us-east-2.amazonaws.com/${fileName}`;
                console.log('Successfully uploaded to S3:', mediaUrl);
            } catch (uploadError) {
                console.error('Error uploading to S3:', uploadError);
                throw new Error('Failed to upload media to S3');
            }
        } else {
            console.log('No file received for upload');
        }

        const review = {
            name,
            text,
            media: mediaUrl,
            mediaType: mediaType || ''
        };

        const collection = db.collection('reviews');
        const result = await collection.insertOne(review);
        res.status(201).json({ message: 'Review saved', reviewId: result.insertedId });
    } catch (error) {
        console.error('Error saving review:', error);
        res.status(500).json({ message: 'Error saving review' });
    }
});
// Endpoint to get all reviews
app.get('/reviews', async (req, res) => {
    try {
        const collection = db.collection('reviews');
        const reviews = await collection.find().toArray();
        res.status(200).json(reviews);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ message: 'Error fetching reviews' });
    }
});

app.get('/', (req, res) => {
    res.send('Momentum Solar Review Server is running!');
});

async function startServer() {
    await connectToMongo();
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

startServer();