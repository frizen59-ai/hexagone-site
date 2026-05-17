// ============================================
// Netlify Function : POST /api/contact
// Envoi d'email de contact
// ============================================
const nodemailer = require('nodemailer');

// Rate limiting simple en mémoire (limité en serverless, mais basique)
const rateLimitMap = new Map();

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Pré-vol CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  // Rate limiting basique par IP
  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 10;

  if (rateLimitMap.has(clientIp)) {
    const entry = rateLimitMap.get(clientIp);
    // Nettoyer les entrées expirées
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
    if (entry.timestamps.length >= maxRequests) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Sécurité Anti-Spam activée : Veuillez patienter avant d\'envoyer un nouveau message.' })
      };
    }
    entry.timestamps.push(now);
  } else {
    rateLimitMap.set(clientIp, { timestamps: [now] });
  }

  try {
    const body = JSON.parse(event.body);
    const { name, email, phone, subject, message } = body;

    // Validation basique des champs requis
    if (!name || !email || !phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Les champs nom, email et téléphone sont obligatoires.' }) };
    }

    // Validation format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Adresse email invalide.' }) };
    }

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
    } else {
      // Ethereal (mode test)
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
    }

    const recipientEmail = process.env.CONTACT_EMAIL || 'contact@hexagone-manutention.test';

    const emailObj = {
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

    const info = await transporter.sendMail(emailObj);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    
    if (previewUrl) {
      console.log('Email de test lisible ici =>', previewUrl);
    } else {
      console.log('✅ Email de contact envoyé avec succès à', recipientEmail);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('Erreur contact:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
