const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true
    },
    author: {
      type: String,
      required: [true, 'Author is required.'],
      trim: true
    },
    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true
    },
    content: {
      type: String
    },
    isbn: {
      type: String,
      trim: true,
      unique: true,
      sparse: true
    },
    category: {
      type: String,
      trim: true
    },
    tags: {
      type: [String],
      default: undefined
    },
    coverImage: {
      type: String
    },
    publishedYear: {
      type: Number,
      min: [1000, 'Published year must be reasonable.'],
      max: [new Date().getFullYear() + 1, 'Published year must be reasonable.']
    },
    totalCopies: {
      type: Number,
      required: [true, 'Total copies is required.'],
      min: [1, 'Total copies must be at least 1.'],
      validate: {
        validator: Number.isInteger,
        message: 'Total copies must be an integer.'
      }
    },
    availableCopies: {
      type: Number,
      required: [true, 'Available copies is required.'],
      min: [0, 'Available copies cannot be negative.'],
      validate: {
        validator: Number.isInteger,
        message: 'Available copies must be an integer.'
      }
    }
  },
  { timestamps: true }
);

bookSchema.pre('validate', function validateAvailability() {
  if (this.availableCopies > this.totalCopies) {
    this.invalidate('availableCopies', 'Available copies cannot exceed total copies.');
  }
});

bookSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    delete returnedObject.__v;
    return returnedObject;
  }
});

module.exports = mongoose.model('Book', bookSchema);
