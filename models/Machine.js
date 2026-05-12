const mongoose = require('mongoose');

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

module.exports = mongoose.model('Machine', MachineSchema);
