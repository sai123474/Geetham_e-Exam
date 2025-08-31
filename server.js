// server.js
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
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { QuestionRecommender } = require('./ml/questionRecommender');

// --- CONFIGURATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Replace with your actual credentials
const API_KEY = "AIzaSyA3WIHFw2_5E8hYUSlG2rrLdq7J7KKwbe0";
const MONGO_URI = "mongodb+srv://yamparalasaikrishna6:Tngy9EWjTg1akDXW@saikrishna.dced3fy.mongodb.net/?retryWrites=true&w=majority&appName=SaiKrishna";
const JWT_SECRET = "Geetham_e_exam2025";
const ADMIN_PASSWORD = "Geetham@2014";
const ENCRYPTION_KEY = "Geetham_secure_encryption_key_2025"; // Key for encrypting sensitive data

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
const genAI = new GoogleGenerativeAI(API_KEY);
const client = new MongoClient(MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});
let db;

// Cache (5 min default TTL)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// ML Recommender
const questionRecommender = new QuestionRecommender();

// --- KNOWLEDGE LIBRARY (In-memory for simplicity) ---
// In production, prefer a vector DB
let knowledgeBase = [];
const upload = multer({ dest: 'uploads/' });

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/api', apiLimiter); // Apply rate limiting to endpoints under /api

// --- ENCRYPTION UTILITIES ---
function encryptData(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
}

function decryptData(encryptedData) {
  const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

function encryptSensitiveData(obj) {
  if (!obj) return obj;
  const sensitiveFields = ['mobile', 'location', 'studentName'];
  const result = { ...obj };
  sensitiveFields.forEach(field => {
    if (result[field]) {
      result[`${field}_encrypted`] = encryptData(result[field]);
      delete result[field];
    }
  });
  return result;
}

function decryptSensitiveData(obj) {
  if (!obj) return obj;
  const result = { ...obj };
  Object.keys(result).forEach(key => {
    if (key.endsWith('_encrypted')) {
      const originalField = key.replace('_encrypted', '');
      try {
        result[originalField] = decryptData(result[key]);
        delete result[key];
      } catch (error) {
        console.error(`Error decrypting ${key}:`, error);
      }
    }
  });
  return result;
}

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

    // Helpful indexes
    await Promise.all([
      db.collection('quizzes').createIndex({ id: 1 }, { unique: true }),
      db.collection('results').createIndex({ mobile_encrypted: 1, quizId: 1 }),
      db.collection('results').createIndex({ quizId: 1 }),
      db.collection('results').createIndex({ date: -1 }),
    ]);

    console.log("Successfully connected to MongoDB Atlas and created indexes!");
  } catch (err) {
    console.error("Failed to connect to MongoDB or create indexes", err);
    process.exit(1);
  }
}

// Helper: train recommender from DB
async function trainRecommenderFromDB() {
  try {
    const quizzes = await db.collection('quizzes').find({}).toArray();
    const allQuestions = [];
    quizzes.forEach(quiz => {
      if (quiz.subjects) {
        Object.entries(quiz.subjects).forEach(([subject, questions]) => {
          (questions || []).forEach(q => {
            allQuestions.push({ ...q, subject, quizId: quiz.id });
          });
        });
      }
    });
    if (allQuestions.length > 0) {
      await questionRecommender.train(allQuestions);
      console.log(`Recommender trained with ${allQuestions.length} questions.`);
    } else {
      console.log('No questions found to train the recommender.');
    }
  } catch (e) {
    console.error('Failed to train recommender:', e);
  }
}

// --- API ENDPOINTS ---

// Admin login -> JWT
app.post('/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
    res.json({
      accessToken: jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '4h' }),
      expiresIn: 4 * 60 * 60
    });
  } else {
    res.status(401).json({ success: false, message: 'Incorrect password' });
  }
});

// Quizzes
app.get('/get-quizzes', async (req, res) => {
  try {
    const cachedQuizzes = cache.get('all_quizzes');
    if (cachedQuizzes) {
      console.info('Serving quizzes from cache');
      return res.json(cachedQuizzes);
    }
    console.info('Fetching quizzes from database');
    const quizzes = await db.collection('quizzes').find({}).toArray();
    cache.set('all_quizzes', quizzes);
    res.json(quizzes);
  } catch (err) {
    console.error('Error fetching quizzes:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching quizzes.',
      error: err.message
    });
  }
});

// Save (replace-all) quizzes array
app.post('/update-quizzes', authenticateToken, async (req, res) => {
  try {
    const updatedQuizzes = req.body;

    if (!Array.isArray(updatedQuizzes)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input: expected an array of quizzes.'
      });
    }
    for (const quiz of updatedQuizzes) {
      if (!quiz.id || !quiz.title) {
        return res.status(400).json({
          success: false,
          message: 'Invalid quiz data: each quiz must have id and title fields.'
        });
      }
    }

    const quizzesCollection = db.collection('quizzes');
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await quizzesCollection.deleteMany({}, { session });
        if (updatedQuizzes.length > 0) {
          await quizzesCollection.insertMany(updatedQuizzes, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    // Invalidate cache & retrain recommender
    cache.del('all_quizzes');
    console.info('Quizzes cache invalidated after update');
    trainRecommenderFromDB(); // fire-and-forget

    res.status(200).json({
      success: true,
      message: 'Quizzes updated successfully.',
      count: updatedQuizzes.length
    });
  } catch (err) {
    console.error('Error saving quizzes:', err);
    res.status(500).json({
      success: false,
      message: 'Error saving quizzes.',
      error: err.message
    });
  }
});

// Attempts guard (supports legacy plaintext mobile + encrypted)
app.post('/check-attempt', async (req, res) => {
  try {
    const { mobile, quizId } = req.body;

    if (!mobile || !quizId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: mobile and quizId are required.'
      });
    }

    let attempt = await db.collection('results').findOne({ mobile, quizId: parseInt(quizId) });

    if (!attempt) {
      const quizResults = await db.collection('results')
        .find({ quizId: parseInt(quizId) })
        .toArray();

      for (const result of quizResults) {
        const decrypted = decryptSensitiveData(result);
        if (decrypted.mobile === mobile) {
          attempt = decrypted;
          break;
        }
      }
    }

    res.json({
      success: true,
      canAttempt: !attempt,
      message: attempt ? "You have already attempted this quiz." : ""
    });
  } catch (err) {
    console.error('Error checking attempt:', err);
    res.status(500).json({
      success: false,
      message: 'Error checking attempt.',
      error: err.message
    });
  }
});

// Student submission (stores encrypted sensitive data)
app.post('/submit-result', async (req, res) => {
  try {
    const newResult = req.body;

    if (!newResult.studentName || !newResult.mobile || !newResult.quizId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: studentName, mobile, and quizId are required.'
      });
    }

    newResult.quizId = parseInt(newResult.quizId);
    if (!newResult.date) newResult.date = new Date().toISOString();

    const encryptedResult = encryptSensitiveData(newResult);
    await db.collection('results').insertOne(encryptedResult);

    // Invalidate any cached results
    cache.keys().forEach(key => key.startsWith('results_') && cache.del(key));
    console.info('Results cache invalidated after new submission');

    res.status(200).json({ success: true, message: 'Result saved successfully.' });
  } catch (err) {
    console.error('Error saving result:', err);
    res.status(500).json({
      success: false,
      message: 'Error saving result.',
      error: err.message
    });
  }
});

// Results (admin only; decrypts before returning; cached briefly)
app.get('/results', authenticateToken, async (req, res) => {
  try {
    const cacheKey = `results_${req.user.user}`;
    const cachedResults = cache.get(cacheKey);
    if (cachedResults) {
      console.info('Serving results from cache');
      return res.json(cachedResults);
    }

    console.info('Fetching results from database');
    const encryptedResults = await db.collection('results').find({}).toArray();
    const results = encryptedResults.map(r => decryptSensitiveData(r));

    cache.set(cacheKey, results, 120); // 2 min TTL for sensitive data
    res.json(results);
  } catch (err) {
    console.error('Error fetching results:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching results.',
      error: err.message
    });
  }
});

// Clear all results (admin)
app.delete('/clear-results', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection('results').deleteMany({});
    res.status(200).json({
      message: 'All results cleared successfully.',
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('Error clearing results:', err);
    res.status(500).send('Error clearing results.');
  }
});

// Pull submissions for a quiz (admin)
app.get('/get-submissions', authenticateToken, async (req, res) => {
  try {
    const { quizId } = req.query;
    if (!quizId) return res.status(400).send('Quiz ID is required');
    const submissions = await db.collection('results').find({ quizId: parseInt(quizId) }).toArray();
    res.json(submissions);
  } catch (err) {
    res.status(500).send('Error fetching submissions.');
  }
});

// Delete a quiz (admin)
app.delete('/delete-quiz/:id', authenticateToken, async (req, res) => {
  try {
    const quizId = parseInt(req.params.id) || req.params.id;
    const quizzesCollection = db.collection('quizzes');
    const result = await quizzesCollection.deleteOne({ id: quizId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Quiz not found.' });
    }

    // Invalidate cache & retrain recommender
    cache.del('all_quizzes');
    console.info('Quizzes cache invalidated after deletion');
    trainRecommenderFromDB(); // fire-and-forget

    res.status(200).json({ success: true, message: 'Quiz deleted successfully.' });
  } catch (err) {
    console.error('Error deleting quiz:', err);
    res.status(500).send('Error deleting quiz.');
  }
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
    const newSubjectScores = {};

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

// AI question generation from uploaded PDFs
app.post('/generate-questions', authenticateToken, async (req, res) => {
  try {
    const { topic, numQuestions, questionType, difficulty } = req.body;

    const contextChunks = knowledgeBase
      .filter(chunk => chunk.toLowerCase().includes((topic || '').toLowerCase()))
      .slice(0, 5);

    if (contextChunks.length === 0) {
      return res.status(404).json({ message: `No information found on "${topic}" in the uploaded books.` });
    }
    const context = contextChunks.join("\n\n");

    const baseInstruction = `Based ONLY on the following context from the official textbook, generate exactly ${numQuestions} questions for a ${difficulty} level MPC exam (JEE/EAMCET standards) on the topic of "${topic}". 
        
IMPORTANT FORMATTING INSTRUCTIONS:
1. Use Unicode math symbols (like ×, ÷, ±, ≤, ≥, ≠, √, ∫, ∑, π, θ, ∞, etc.) instead of LaTeX or MathJax.
2. For fractions, use Unicode fraction symbols (½, ¼, etc.) or simple notation like "a/b" instead of LaTeX fractions.
3. For exponents, use superscript Unicode characters (x², x³, etc.) or simple notation like "x^2".
4. For subscripts, use simple notation like "x_n" instead of LaTeX subscripts.
5. NEVER use LaTeX syntax like \\frac{}{}, \\sqrt{}, \\int, etc.
6. For complex equations, break them into simpler parts using Unicode symbols.

Output only a raw, valid JSON array. The array must contain exactly ${numQuestions} objects.`;

    let prompt;
    if (questionType === 'fill-in-the-blank') {
      prompt = `${baseInstruction} Each object must have keys "text" (with a blank as "____") and "answerKey". For answerKey, provide answers separated by '|'. CONTEXT: """${context}"""`;
    } else {
      prompt = `${baseInstruction} Each object must have keys "text", "options" (an array of 4 strings), and "correctAnswer" (a 0-based index). CONTEXT: """${context}"""`;
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().replace(/```json|```/g, '').trim();
      const parsedQuestions = JSON.parse(text);
      res.json(parsedQuestions);
    } catch (parseError) {
      console.error("AI generation error:", parseError);
      res.status(500).json({
        message: "Failed to generate valid questions. Please try again with a different topic or fewer questions.",
        error: parseError.message
      });
    }
  } catch (error) {
    console.error("Server error in question generation:", error);
    res.status(500).json({
      message: "Server error while generating questions. Please try again later.",
      error: error.message
    });
  }
});

// --- MACHINE LEARNING ENDPOINTS (secured under /api/*) ---

// Train the question recommender with existing questions
app.post('/api/train-recommender', authenticateToken, async (req, res) => {
  try {
    await trainRecommenderFromDB();
    res.json({ success: true, message: 'Recommender (re)trained.' });
  } catch (err) {
    console.error('Error training recommender:', err);
    res.status(500).json({
      success: false,
      message: 'Error training recommender',
      error: err.message
    });
  }
});

// Get similar questions
app.post('/api/recommend-similar-questions', authenticateToken, async (req, res) => {
  try {
    const { questionText, count = 5 } = req.body;
    if (!questionText) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }
    const recommendations = questionRecommender.recommendSimilarQuestions(questionText, count);
    res.json({ success: true, recommendations });
  } catch (err) {
    console.error('Error recommending questions:', err);
    res.status(500).json({ success: false, message: 'Error recommending questions', error: err.message });
  }
});

// Get personalized question recommendations
app.post('/api/recommend-personalized-questions', authenticateToken, async (req, res) => {
  try {
    const { studentId, count = 5 } = req.body;
    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Student ID is required' });
    }

    const studentResults = await db.collection('results').findOne({ _id: new ObjectId(studentId) });
    if (!studentResults || !studentResults.responses) {
      return res.status(404).json({ success: false, message: 'Student results not found' });
    }

    const recommendations = questionRecommender.recommendPersonalizedQuestions(studentResults.responses, count);
    res.json({ success: true, recommendations });
  } catch (err) {
    console.error('Error generating personalized recommendations:', err);
    res.status(500).json({ success: false, message: 'Error generating personalized recommendations', error: err.message });
  }
});

// Predict question difficulty
app.post('/api/predict-difficulty', authenticateToken, async (req, res) => {
  try {
    const { questions } = req.body;
    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: 'Questions array is required' });
    }
    const difficulties = questionRecommender.predictDifficulty(questions);
    res.json({ success: true, difficulties });
  } catch (err) {
    console.error('Error predicting difficulty:', err);
    res.status(500).json({ success: false, message: 'Error predicting difficulty', error: err.message });
  }
});

// --- START SERVER ---
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
});
