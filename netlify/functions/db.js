// ============================================
// Module partagé : Connexion MongoDB + Modèle Machine
// Utilisé par toutes les Netlify Functions
// ============================================
const mongoose = require('mongoose');

let cachedDb = null;

const MachineSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // Réf HEX...
  name: { type: String, required: true },
  type: { type: String }, // chariot, nacelle
  energy: { type: String }, // gaz, elec, diesel
  year: { type: Number },
  hours: { type: String },
  price: { type: Number, required: true },
  priceLabel: { type: String, default: 'HT' },
  image: { type: String }, // URL Cloudinary
  cloudinary_id: { type: String }, // Identifiant pour suppression Cloudinary
  specs: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

// Éviter la re-déclaration du modèle en cas de "warm start" serverless
const Machine = mongoose.models.Machine || mongoose.model('Machine', MachineSchema);

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI non configuré dans les variables d\'environnement Netlify');
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    family: 4
  });

  cachedDb = mongoose.connection;
  console.log('✅ Connecté à MongoDB Atlas (Netlify Function)');
  return cachedDb;
}

module.exports = { connectToDatabase, Machine };
