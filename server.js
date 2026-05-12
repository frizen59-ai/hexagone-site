require('dotenv').config();
const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const sharp = require('sharp');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Machine = require('./models/Machine');

// Config Cloudinary
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

// Connexion MongoDB
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    family: 4
  })
    .then(() => console.log('✅ Connecté à MongoDB Atlas'))
    .catch(err => console.error('❌ Erreur de connexion MongoDB:', err));
} else {
  console.log('⚠️ Aucune URI MongoDB fournie dans .env. La base de données ne fonctionnera pas.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURATION EMAILS (Nodemailer)
// ==========================================
let transporter;

// Si les variables SMTP sont configurées, utiliser le vrai serveur SMTP
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log('✅ Configuration E-mail PRODUCTION prête (SMTP)');
} else {
  // Sinon, utiliser Ethereal (serveur de test — les emails ne sont PAS réellement envoyés)
  nodemailer.createTestAccount((err, account) => {
    if (err) {
      console.error('Échec de la création du compte e-mail Ethereal: ' + err.message);
      return;
    }
    console.log('⚠️  Configuration E-mail de TEST prête (Ethereal — les emails ne sont PAS envoyés pour de vrai)');
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass
      }
    });
  });
}

// ==========================================
// CONFIGURATIONS SYSTEMES
// ==========================================
// Les images sont stockées en mémoire pour être compressées par Sharp avant sauvegarde (sur Cloudinary)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les formats jpg, jpeg, png et webp sont autorisés.'));
    }
  }
});

const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
  challenge: true,
  realm: 'Hexagone Manutention Admin Area'
});

// Middlewares
app.use(helmet({ contentSecurityPolicy: false })); // Sécurité basique activée sans bloquer nos scripts HTML
app.use('/admin.html', adminAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// ==========================================
// ROUTES API - MACHINES
// ==========================================

// RECUPERER les machines
app.get('/api/machines', async (req, res) => {
  try {
    const machines = await Machine.find().sort({ createdAt: -1 });
    res.json(machines);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur MongoDB' });
  }
});

// AJOUTER une machine (ADMIN)
app.post('/api/machines', adminAuth, (req, res, next) => {
  upload.single('photo')(req, res, function (err) {
    if (err) return res.status(400).send(`Erreur d'upload: ${err.message}`);
    next();
  });
}, async (req, res) => {
  // Validation des champs requis
  const { nom, prix, specs } = req.body;
  if (!nom || nom.trim() === '') return res.status(400).send("Le nom de la machine est requis.");
  if (!prix || isNaN(parseInt(prix))) return res.status(400).send("Un prix valide est requis.");
  if (!specs || specs.trim() === '') return res.status(400).send("La description (specs) est requise.");

  try {
    let imageUrl = 'https://placehold.co/600x400?text=Photo+Manquante';
    let cloudinaryId = null;

    if (req.file) {
      // Compresser avec sharp
      const buffer = await sharp(req.file.buffer)
        .rotate()
        .resize(1280, 960, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      // Upload Cloudinary via stream
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: 'hexagone', format: 'webp' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        Readable.from(buffer).pipe(uploadStream);
      });

      imageUrl = uploadResult.secure_url;
      cloudinaryId = uploadResult.public_id;
    }

    const nouvelleMachine = new Machine({
      id: req.body.ref || `HEX${Date.now().toString().slice(-4)}`,
      name: req.body.nom,
      type: req.body.type,
      energy: req.body.energie,
      year: parseInt(req.body.annee) || new Date().getFullYear(),
      hours: req.body.heures + " h",
      price: parseInt(req.body.prix),
      priceLabel: "HT",
      image: imageUrl,
      cloudinary_id: cloudinaryId,
      specs: req.body.specs ? req.body.specs.split(',').map(s=>s.trim()) : []
    });

    if (nouvelleMachine.type === 'nacelle' && (!nouvelleMachine.specs || nouvelleMachine.specs.length === 0)) {
        nouvelleMachine.specs = ["Plusieurs exemplaires en stock"];
    }

    await nouvelleMachine.save();
    res.redirect('/admin.html?success=true');
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur lors de la sauvegarde (Cloudinary/MongoDB)");
  }
});

// SUPPRIMER une machine (ADMIN)
app.delete('/api/machines/:id', adminAuth, async (req, res) => {
  try {
    const idToDelete = req.params.id;
    console.log(`🗑️ Tentative de suppression de la machine: "${idToDelete}"`);
    
    // Chercher d'abord par le champ custom "id" (HEX...)
    let machine = await Machine.findOne({ id: idToDelete });
    
    // Fallback: chercher par le _id MongoDB
    if (!machine && mongoose.Types.ObjectId.isValid(idToDelete)) {
      machine = await Machine.findById(idToDelete);
    }
    
    if (!machine) {
      console.log(`❌ Machine non trouvée avec id: "${idToDelete}"`);
      return res.status(404).json({ error: 'Machine non trouvée' });
    }

    console.log(`✅ Machine trouvée: "${machine.name}" (id: ${machine.id}, _id: ${machine._id})`);

    // Supprimer l'image de Cloudinary si elle existe
    if (machine.cloudinary_id) {
      try {
        await cloudinary.uploader.destroy(machine.cloudinary_id);
        console.log(`☁️ Image Cloudinary supprimée: ${machine.cloudinary_id}`);
      } catch (cloudErr) {
        console.error('⚠️ Erreur suppression Cloudinary (non bloquant):', cloudErr.message);
      }
    }
    
    await Machine.findByIdAndDelete(machine._id);
    console.log(`✅ Machine "${machine.name}" supprimée avec succès.`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erreur lors de la suppression:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ==========================================
// ROUTES API - EMAILS
// ==========================================
const contactLimiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limite chaque IP à 10 requêtes de contact par fenêtre
  message: { error: 'Sécurité Anti-Spam activée : Veuillez patienter avant d\'envoyer un nouveau message.' } 
});

app.post('/api/contact', contactLimiter, (req, res) => {
    if (!transporter) return res.status(500).json({ error: 'Service email non prêt' });
    
    const { name, email, phone, subject, message } = req.body;

    // Validation basique des champs requis
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Les champs nom, email et téléphone sont obligatoires.' });
    }
    
    // Validation format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const recipientEmail = process.env.CONTACT_EMAIL || 'contact@hexagone-manutention.test';
    
    let emailObj = {
        from: `"Hexagone Manutention - Site Web" <${process.env.SMTP_USER || 'noreply@hexagone-manutention.fr'}>`,
        replyTo: `"${name}" <${email}>`,
        to: recipientEmail,
        subject: subject || 'Nouvelle demande depuis le site',
        text: `Nouveau message reçu depuis le site public.

Nom: ${name}
Téléphone: ${phone}
Email: ${email}
----------------------
Sujet de la demande : ${subject}

Message :
${message || '(Aucun message)'}
`
    };

    transporter.sendMail(emailObj, (err, info) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) console.log('Email de test lisible ici => %s', previewUrl);
        else console.log('✅ Email de contact envoyé avec succès à', recipientEmail);
        res.json({ success: true });
    });
});

// Route par défaut — Toutes les pages non-API servent index.html (SPA)
// Les routes /api inexistantes renvoient une 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API non trouvée.' });
});

app.use((req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
    console.log(`Le serveur Hexagone Manutention a démarré avec succès.`);
    console.log(`Port: http://localhost:${PORT}`);
});
