const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// Use environment variables for sensitive data
const API_KEY ="AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const MONGO_URI ="mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const JWT_SECRET ="Geetham_e_exam2025";
const ADMIN_PASSWORD = "Geetham@2014";

if (!API_KEY || !MONGO_URI || !JWT_SECRET || !ADMIN_PASSWORD) {
    console.error("FATAL ERROR: Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const genAI = new GoogleGenerativeAI(API_KEY);
const client = new MongoClient(MONGO_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});
let db;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves static files from 'public' directory

// --- AUTHENTICATION MIDDLEWARE ---
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

// --- DATABASE CONNECTION ---
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

// Admin Login
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
        const accessToken = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ accessToken });
    } else {
        res.status(401).send('Incorrect password');
    }
});

// Get all quizzes
app.get('/get-quizzes', async (req, res) => {
    try {
        const quizzesCollection = db.collection('quizzes');
        const allQuizzes = await quizzesCollection.find({}).toArray();
        res.json(allQuizzes);
    } catch (err) {
        res.status(500).send('Error fetching quizzes.');
    }
});

// Update all quizzes (Admin Panel)
app.post('/update-quizzes', authenticateToken, async (req, res) => {
    try {
        const updatedQuizzes = req.body;
        const quizzesCollection = db.collection('quizzes');
        await quizzesCollection.deleteMany({});
        if (updatedQuizzes.length > 0) {
            // Ensure all quiz IDs are numbers before inserting
            updatedQuizzes.forEach(quiz => {
                if(typeof quiz.id !== 'number') quiz.id = Date.now() + Math.random();
            });
            await quizzesCollection.insertMany(updatedQuizzes);
        }
        res.status(200).send('Quizzes updated successfully.');
    } catch (err) {
        res.status(500).send('Error saving quizzes.');
    }
});

// Check if a student has already attempted a quiz
app.post('/check-attempt', async (req, res) => {
    try {
        const { mobile, quizId } = req.body;
        const resultsCollection = db.collection('results');
        const existingAttempt = await resultsCollection.findOne({ mobile, quizId: parseInt(quizId) });
        if (existingAttempt) {
            res.json({ canAttempt: false, message: "You have already attempted this quiz." });
        } else {
            res.json({ canAttempt: true });
        }
    } catch (err) {
        res.status(500).send('Error checking attempt.');
    }
});

// Submit a student's result
app.post('/submit-result', async (req, res) => {
    try {
        const newResult = req.body;
        newResult.quizId = parseInt(newResult.quizId); // Ensure quizId is a number
        const resultsCollection = db.collection('results');
        await resultsCollection.insertOne(newResult);
        res.status(200).send('Result saved successfully.');
    } catch (err) {
        res.status(500).send('Error saving result.');
    }
});

// Get all results for the dashboard
app.get('/results', async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        const allResults = await resultsCollection.find({}).toArray();
        res.json(allResults);
    } catch (err) {
        res.status(500).send('Error fetching results.');
    }
});

// Get submissions for teacher review
app.get('/get-submissions', authenticateToken, async (req, res) => {
    try {
        const { quizId } = req.query;
        if (!quizId) return res.status(400).send('Quiz ID is required');

        const resultsCollection = db.collection('results');
        const submissions = await resultsCollection.find({ quizId: parseInt(quizId) }).toArray();
        
        // The front-end now has the quiz data, so we can send the raw submissions
        // This simplifies the backend and ensures the front-end has all necessary data
        res.json(submissions);

    } catch (err) {
        console.error('Error fetching submissions:', err);
        res.status(500).send('Error fetching submissions.');
    }
});

// =================================================================
// ===== NEW ENDPOINT FOR GRADING DASHBOARD STARTS HERE ============
// =================================================================

app.post('/grade-submission', authenticateToken, async (req, res) => {
    try {
        const studentSubmission = req.body;
        if (!studentSubmission || !studentSubmission._id || !studentSubmission.responses) {
            return res.status(400).json({ message: 'Invalid submission data.' });
        }

        const resultsCollection = db.collection('results');
        const quizzesCollection = db.collection('quizzes');
        
        // 1. Find the original submission to get the quizId
        const originalResult = await resultsCollection.findOne({ _id: new ObjectId(studentSubmission._id) });
        if (!originalResult) {
            return res.status(404).json({ message: 'Submission not found.' });
        }

        // 2. Find the corresponding quiz to get question data and marking schemes
        const quiz = await quizzesCollection.findOne({ id: originalResult.quizId });
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz data not found for this submission.' });
        }

        // 3. Securely recalculate the total score on the server
        let newTotalScore = 0;
        Object.keys(quiz.subjects).forEach(subjectName => {
            if (!quiz.subjects[subjectName]) return;

            quiz.subjects[subjectName].forEach((question, qIndex) => {
                const response = studentSubmission.responses?.[subjectName]?.[qIndex];
                let marksObtained = 0;
                
                const marksCorrect = (quiz.marksMode === 'custom' ? question.correctMarks : quiz.correctMarks) ?? 1;
                const marksIncorrect = (quiz.marksMode === 'custom' ? question.wrongMarks : quiz.wrongMarks) ?? 0;

                const hasAnswer = response && response.answer !== undefined && response.answer !== '';

                if (question.type === 'multiple-choice') {
                    // Note: originalResult must have the shuffledCorrectAnswerIndex saved with it
                    // For this to work, ensure the `submit-result` endpoint saves this info.
                    // We'll assume `originalResult.responses` contains this.
                    const originalResponse = originalResult.responses?.[subjectName]?.[qIndex];
                    if (hasAnswer && originalResponse && response.answer === originalResponse.shuffledCorrectAnswerIndex) {
                        marksObtained = marksCorrect;
                    } else {
                        marksObtained = marksIncorrect;
                    }
                } else if (question.type === 'fill-in-the-blank') {
                    if (hasAnswer) {
                        const correctAnswers = (question.answerKey || '').split('|').map(a => a.trim().toLowerCase());
                        const isCorrect = correctAnswers.includes(response.answer.toString().trim().toLowerCase());
                        marksObtained = isCorrect ? marksCorrect : marksIncorrect;
                    } else {
                        marksObtained = marksIncorrect;
                    }
                } else if (question.type === 'subjective') {
                    marksObtained = response?.marks || 0;
                }
                newTotalScore += marksObtained;
            });
        });

        // 4. Update the database with new responses and the recalculated total score
        const updateResult = await resultsCollection.updateOne(
            { _id: new ObjectId(studentSubmission._id) },
            { 
                $set: { 
                    responses: studentSubmission.responses, // Save the teacher's marks
                    totalScore: newTotalScore // Save the newly calculated score
                }
            }
        );

        if (updateResult.modifiedCount === 0) {
            return res.status(304).json({ message: 'No changes were made to the submission.' });
        }

        res.status(200).json({ message: 'Grades updated successfully!', newTotalScore });
    } catch (err) {
        console.error('Error grading submission:', err);
        res.status(500).json({ message: 'An error occurred while saving grades.' });
    }
});


// =================================================================
// ===== NEW ENDPOINT FOR GRADING DASHBOARD ENDS HERE ==============
// =================================================================


// Clear all results (requires authentication)
app.post('/clear-results', authenticateToken, async (req, res) => {
    try {
        const resultsCollection = db.collection('results');
        await resultsCollection.deleteMany({});
        res.status(200).send('Results cleared successfully.');
    } catch (err) {
        res.status(500).send('Error clearing results.');
    }
});
// Delete a quiz by ID (Admin only)
app.delete('/delete-quiz/:id', authenticateToken, async (req, res) => {
    try {
        const quizId = parseInt(req.params.id);
        if (isNaN(quizId)) return res.status(400).send('Invalid quiz ID');

        const quizzesCollection = db.collection('quizzes');
        const result = await quizzesCollection.deleteOne({ id: quizId });

        if (result.deletedCount === 0) {
            return res.status(404).send('Quiz not found');
        }

        res.status(200).send('Quiz deleted successfully');
    } catch (err) {
        console.error('Error deleting quiz:', err);
        res.status(500).send('Failed to delete quiz');
    }
});

// --- AI Endpoints ---

app.post('/ai-analysis', authenticateToken, async (req, res) => {
    try {
        const { studentName, subjectScores } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Analyze the performance of student ${studentName} based on these subject scores: ${JSON.stringify(subjectScores)}. Provide a brief, encouraging analysis (50-70 words) identifying one strength and one area for improvement. Format as a single JSON object with one key: "report".`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to generate AI analysis.");
    }
});

app.post('/generate-questions', authenticateToken, async (req, res) => {
    try {
        const { topic, numQuestions } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Generate ${numQuestions} multiple-choice questions for a JEE Mains level exam on the topic of "${topic}". Provide question text, four options, and the 0-based index of the correct answer. Format as a single, valid JSON array of objects. Each object must have keys: "text", "options", and "correctAnswer". Output only the raw JSON array.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) {
        res.status(500).send("Failed to generate questions with AI.");
    }
});

app.post('/generate-from-text', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = `Analyze the following text and convert it into a valid JSON array of objects. Each object must have keys: "subject", "text", "options", and "correctAnswer" (0-based index). Extract all questions. Output only the raw JSON array. Text: "${text}"`;
        const result = await model.generateContent(prompt);
        const aiResponseText = result.response.text().replace(/```json|```/g, '').trim();
        res.json(JSON.parse(aiResponseText));
    } catch (error) {
        res.status(500).send("Failed to process text with AI.");
    }
});

// --- START SERVER ---
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
});
