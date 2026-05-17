// ============================================
// Netlify Function : DELETE /api/machines/:id
// Supprimer une machine (protégé par Basic Auth)
// ============================================
const mongoose = require('mongoose');
const { connectToDatabase, Machine } = require('./db');
const cloudinary = require('cloudinary').v2;

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

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
  };

  // Pré-vol CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  if (!checkAuth(event)) {
    return {
      statusCode: 401,
      headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Hexagone Admin"' },
      body: JSON.stringify({ error: 'Authentification requise' })
    };
  }

  try {
    await connectToDatabase();

    // Extraire l'ID depuis le path : /api/machines/:id
    const pathParts = event.path.split('/');
    const idToDelete = decodeURIComponent(pathParts[pathParts.length - 1]);

    console.log(`🗑️ Tentative de suppression de la machine: "${idToDelete}"`);

    // Chercher d'abord par le champ custom "id" (HEX...)
    let machine = await Machine.findOne({ id: idToDelete });

    // Fallback: chercher par le _id MongoDB
    if (!machine && mongoose.Types.ObjectId.isValid(idToDelete)) {
      machine = await Machine.findById(idToDelete);
    }

    if (!machine) {
      console.log(`❌ Machine non trouvée avec id: "${idToDelete}"`);
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Machine non trouvée' }) };
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

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('❌ Erreur lors de la suppression:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur lors de la suppression' }) };
  }
};
