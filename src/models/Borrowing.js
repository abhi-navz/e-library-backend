const mongoose = require('mongoose');

const borrowingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: true
    },
    borrowedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    dueDate: {
      type: Date,
      required: true
    },
    returnedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      required: true,
      enum: ['borrowed', 'returned'],
      default: 'borrowed'
    }
  },
  { timestamps: true }
);

// Only active loans must be unique; a returned book may be borrowed again.
borrowingSchema.index(
  { user: 1, book: 1 },
  { unique: true, partialFilterExpression: { status: 'borrowed' } }
);
borrowingSchema.index({ user: 1, borrowedAt: -1 });
borrowingSchema.index({ book: 1, status: 1 });

borrowingSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    delete returnedObject.__v;
    return returnedObject;
  }
});

module.exports = mongoose.model('Borrowing', borrowingSchema);
