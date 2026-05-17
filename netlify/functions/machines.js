// ============================================
// Netlify Function : /api/machines
// GET  → Récupérer toutes les machines
// POST → Ajouter une machine (protégé par Basic Auth)
// ============================================
const { connectToDatabase, Machine } = require('./db');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Vérification Basic Auth
function checkAuth(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  
  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD;
}

// Parser multipart/form-data manuellement (Netlify Functions)
function parseMultipart(event) {
  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return { fields: {}, file: null };

  const boundary = boundaryMatch[1];
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body);

  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  
  let start = 0;
  let idx = body.indexOf(boundaryBuffer, start);
  
  while (idx !== -1) {
    const nextIdx = body.indexOf(boundaryBuffer, idx + boundaryBuffer.length);
    if (nextIdx === -1) break;
    
    const part = body.slice(idx + boundaryBuffer.length, nextIdx);
    parts.push(part);
    idx = nextIdx;
  }

  const fields = {};
  let file = null;

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    
    const headers = part.slice(0, headerEnd).toString();
    const content = part.slice(headerEnd + 4, part.length - 2); // Remove trailing \r\n
    
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    
    if (!nameMatch) continue;
    
    if (filenameMatch && filenameMatch[1]) {
      const mimeMatch = headers.match(/Content-Type:\s*(.+)/i);
      file = {
        fieldname: nameMatch[1],
        originalname: filenameMatch[1],
        mimetype: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
        buffer: content
      };
    } else {
      fields[nameMatch[1]] = content.toString().trim();
    }
  }

  return { fields, file };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Pré-vol CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    await connectToDatabase();

    // ── GET : Récupérer toutes les machines ──
    if (event.httpMethod === 'GET') {
      const machines = await Machine.find().sort({ createdAt: -1 });
      return { statusCode: 200, headers, body: JSON.stringify(machines) };
    }

    // ── POST : Ajouter une machine (Admin) ──
    if (event.httpMethod === 'POST') {
      if (!checkAuth(event)) {
        return {
          statusCode: 401,
          headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Hexagone Admin"' },
          body: JSON.stringify({ error: 'Authentification requise' })
        };
      }

      const { fields, file } = parseMultipart(event);
      const { nom, prix, specs, ref, type, energie, annee, heures } = fields;

      // Validation
      if (!nom || nom.trim() === '') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Le nom de la machine est requis.' }) };
      }
      if (!prix || isNaN(parseInt(prix))) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Un prix valide est requis.' }) };
      }
      if (!specs || specs.trim() === '') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'La description (specs) est requise.' }) };
      }

      let imageUrl = 'https://placehold.co/600x400?text=Photo+Manquante';
      let cloudinaryId = null;

      if (file && file.buffer.length > 0) {
        // Vérifier le type de fichier
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Seuls les formats jpg, jpeg, png et webp sont autorisés.' }) };
        }

        // Compresser avec sharp
        const buffer = await sharp(file.buffer)
          .rotate()
          .resize(1280, 960, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();

        // Upload Cloudinary via base64
        const base64 = buffer.toString('base64');
        const uploadResult = await cloudinary.uploader.upload(
          `data:image/webp;base64,${base64}`,
          { folder: 'hexagone', format: 'webp' }
        );

        imageUrl = uploadResult.secure_url;
        cloudinaryId = uploadResult.public_id;
      }

      const nouvelleMachine = new Machine({
        id: ref || `HEX${Date.now().toString().slice(-4)}`,
        name: nom,
        type: type,
        energy: energie,
        year: parseInt(annee) || new Date().getFullYear(),
        hours: heures + " h",
        price: parseInt(prix),
        priceLabel: "HT",
        image: imageUrl,
        cloudinary_id: cloudinaryId,
        specs: specs ? specs.split(',').map(s => s.trim()) : []
      });

      if (nouvelleMachine.type === 'nacelle' && (!nouvelleMachine.specs || nouvelleMachine.specs.length === 0)) {
        nouvelleMachine.specs = ["Plusieurs exemplaires en stock"];
      }

      await nouvelleMachine.save();

      // Pour l'admin, on redirige vers la page admin avec message de succès
      return {
        statusCode: 302,
        headers: { ...headers, Location: '/admin.html?success=true' },
        body: ''
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  } catch (error) {
    console.error('Erreur fonction machines:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
