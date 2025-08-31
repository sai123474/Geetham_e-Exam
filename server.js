const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const pdf = require('pdf-parse');
const fs = require('fs');

// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Replace with your actual credentials
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const JWT_SECRET = "Geetham_e_exam2025";
const ADMIN_PASSWORD = "Geetham@2014";

const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const genAI = new GoogleGenerativeAI(API_KEY);
const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});
let db;

// --- KNOWLEDGE LIBRARY (In-memory for simplicity) ---
// In production, use a dedicated Vector Database (Pinecone, ChromaDB, etc.)
let knowledgeBase = []; 
const upload = multer({ dest: 'uploads/' }); // Temp folder for uploads

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

async function connectDB() {
    try {
        await client.connect();
        db = client.db("GeethamQuizDB");
        console.log("Successfully connected to MongoDB Atlas!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

// --- API ENDPOINTS ---

app.post('/login', (req, res) => {
    const { password } = req.body;
    if (bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
        res.json({ accessToken: jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '8h' }) });
    } else {
        res.status(401).send('Incorrect password');
    }
});

app.get('/get-quizzes', async (req, res) => {
    try {
        const quizzes = await db.collection('quizzes').find({}).toArray();
        res.json(quizzes);
    } catch (err) { res.status(500).send('Error fetching quizzes.'); }
});

app.post('/update-quizzes', authenticateToken, async (req, res) => {
    try {
        const updatedQuizzes = req.body;
        const quizzesCollection = db.collection('quizzes');
        await quizzesCollection.deleteMany({});
        if (updatedQuizzes.length > 0) {
            await quizzesCollection.insertMany(updatedQuizzes);
        }
        res.status(200).send('Quizzes updated successfully.');
    } catch (err) { res.status(500).send('Error saving quizzes.'); }
});

app.post('/check-attempt', async (req, res) => {
    try {
        const { mobile, quizId } = req.body;
        const attempt = await db.collection('results').findOne({ mobile, quizId: parseInt(quizId) });
        res.json({ canAttempt: !attempt, message: attempt ? "You have already attempted this quiz." : "" });
    } catch (err) { res.status(500).send('Error checking attempt.'); }
});

app.post('/submit-result', async (req, res) => {
    try {
        const newResult = req.body;
        newResult.quizId = parseInt(newResult.quizId);
        await db.collection('results').insertOne(newResult);
        res.status(200).send('Result saved successfully.');
    } catch (err) { res.status(500).send('Error saving result.'); }
});

app.get('/results', async (req, res) => {
    try {
        const results = await db.collection('results').find({}).toArray();
        res.json(results);
    } catch (err) { res.status(500).send('Error fetching results.'); }
});

app.get('/get-submissions', authenticateToken, async (req, res) => {
    try {
        const { quizId } = req.query;
        if (!quizId) return res.status(400).send('Quiz ID is required');
        const submissions = await db.collection('results').find({ quizId: parseInt(quizId) }).toArray();
        res.json(submissions);
    } catch (err) { res.status(500).send('Error fetching submissions.'); }
});

// FINAL, AUTHORITATIVE SCORE RECALCULATION LOGIC
app.post('/grade-submission', authenticateToken, async (req, res) => {
    try {
        const studentSubmission = req.body;
        if (!studentSubmission?._id || !studentSubmission.responses) {
            return res.status(400).json({ message: 'Invalid submission data.' });
        }

        const resultsCollection = db.collection('results');
        const quizzesCollection = db.collection('quizzes');
        
        const originalResult = await resultsCollection.findOne({ _id: new ObjectId(studentSubmission._id) });
        if (!originalResult) return res.status(404).json({ message: 'Submission not found.' });

        const quiz = await quizzesCollection.findOne({ id: originalResult.quizId });
        if (!quiz) return res.status(404).json({ message: 'Quiz data not found.' });

        let newTotalScore = 0;
        let newSubjectScores = {};

        for (const subjectName in quiz.subjects) {
            let currentSubjectScore = 0;
            if (!quiz.subjects[subjectName]) continue;

            for (let qIndex = 0; qIndex < quiz.subjects[subjectName].length; qIndex++) {
                const question = quiz.subjects[subjectName][qIndex];
                const updatedResponse = studentSubmission.responses?.[subjectName]?.[qIndex];
                const originalResponse = originalResult.responses?.[subjectName]?.[qIndex];
                let marksObtained = 0;
                
                const marksCorrect = (quiz.marksMode === 'custom' ? question.correctMarks : quiz.correctMarks) ?? 1;
                const marksIncorrect = (quiz.marksMode === 'custom' ? question.wrongMarks : quiz.wrongMarks) ?? 0;

                if (question.type === 'subjective') {
                    marksObtained = updatedResponse?.marks || 0;
                } else if (question.type === 'multiple-choice') {
                    if (originalResponse?.answer !== undefined && originalResponse.answer === originalResponse.shuffledCorrectAnswerIndex) {
                        marksObtained = marksCorrect;
                    } else {
                        marksObtained = marksIncorrect;
                    }
                } else if (question.type === 'fill-in-the-blank') {
                    if (originalResponse?.answer) {
                        const correctAnswers = (question.answerKey || '').split('|').map(a => a.trim().toLowerCase());
                        const isCorrect = correctAnswers.includes(originalResponse.answer.toString().trim().toLowerCase());
                        marksObtained = isCorrect ? marksCorrect : marksIncorrect;
                    } else {
                        marksObtained = marksIncorrect;
                    }
                }
                currentSubjectScore += marksObtained;
            }
            newSubjectScores[subjectName] = currentSubjectScore;
            newTotalScore += currentSubjectScore;
        }

        await resultsCollection.updateOne(
            { _id: new ObjectId(studentSubmission._id) },
            { $set: { responses: studentSubmission.responses, totalScore: newTotalScore, subjectScores: newSubjectScores } }
        );

        res.status(200).json({ message: 'Grades updated successfully!', newTotalScore });
    } catch (err) {
        console.error('Error grading submission:', err);
        res.status(500).json({ message: 'An error occurred while saving grades.' });
    }
});

// KNOWLEDGE LIBRARY & AI ENDPOINTS
app.post('/upload-pdfs', authenticateToken, upload.array('pdfs'), async (req, res) => {
    try {
        knowledgeBase = [];
        for (const file of req.files) {
            const dataBuffer = fs.readFileSync(file.path);
            const data = await pdf(dataBuffer);
            const chunks = data.text.split(/\n\s*\n/);
            knowledgeBase.push(...chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 50));
            fs.unlinkSync(file.path);
        }
        res.status(200).send(`Knowledge library updated with content from ${req.files.length} PDF(s).`);
    } catch (error) {
        res.status(500).send("Failed to process PDFs.");
    }
});

app.post('/generate-questions', authenticateToken, async (req, res) => {
    try {
        const { topic, numQuestions, questionType, difficulty } = req.body;

        const contextChunks = knowledgeBase.filter(chunk => chunk.toLowerCase().includes(topic.toLowerCase())).slice(0, 5);
        if (contextChunks.length === 0) {
            return res.status(404).json({ message: `No information found on "${topic}" in the uploaded books.` });
        }
        const context = contextChunks.join("\n\n");

        let prompt;
        const baseInstruction = `Based ONLY on the following context from the official textbook, generate exactly ${numQuestions} questions for a ${difficulty} level MPC exam (JEE/EAMCET standards) on the topic of "${topic}". Output only a raw, valid JSON array. The array must contain exactly ${numQuestions} objects.`;
        
        switch (questionType) {
            case 'fill-in-the-blank':
                prompt = `${baseInstruction} Each object must have keys "text" (with a blank as "____") and "answerKey". For answerKey, provide answers separated by '|'. CONTEXT: """${context}"""`;
                break;
            default:
                prompt = `${baseInstruction} Each object must have keys "text", "options" (an array of 4 strings), and "correctAnswer" (a 0-based index). CONTEXT: """${context}"""`;
                break;
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to generate questions with AI.");
    }
});

// --- START SERVER ---
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
});
