import { body } from 'express-validator';

export const validateVideoUpload = [
  body('title')
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 3, max: 100 })
    .withMessage('Title must be between 3 and 100 characters')
    .trim(),
  
  body('description')
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be between 10 and 1000 characters')
    .trim(),
  
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isIn(['entertainment', 'education', 'music', 'sports', 'news', 'gaming', 'technology', 'other'])
    .withMessage('Invalid category'),
  
  body('author')
    .notEmpty()
    .withMessage('Author name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Author name must be between 2 and 50 characters')
    .trim(),
  
  body('thumbnail')
    .optional()
    .isURL()
    .withMessage('Thumbnail must be a valid URL'),
  
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          const tags = JSON.parse(value);
          if (!Array.isArray(tags)) {
            throw new Error('Tags must be an array');
          }
          if (tags.length > 10) {
            throw new Error('Maximum 10 tags allowed');
          }
          return true;
        } catch (error) {
          throw new Error('Invalid tags format');
        }
      } else if (Array.isArray(value)) {
        if (value.length > 10) {
          throw new Error('Maximum 10 tags allowed');
        }
        return true;
      } else if (value !== undefined && value !== null) {
        throw new Error('Tags must be an array');
      }
      return true;
    })
];

export const validateVideoUpdate = [
  body('title')
    .optional()
    .isLength({ min: 3, max: 100 })
    .withMessage('Title must be between 3 and 100 characters')
    .trim(),
  
  body('description')
    .optional()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be between 10 and 1000 characters')
    .trim(),
  
  body('category')
    .optional()
    .isIn(['entertainment', 'education', 'music', 'sports', 'news', 'gaming', 'technology', 'other'])
    .withMessage('Invalid category'),
  
  body('author')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Author name must be between 2 and 50 characters')
    .trim(),
  
  body('thumbnail')
    .optional()
    .isURL()
    .withMessage('Thumbnail must be a valid URL'),
  
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Tags must be an array with maximum 10 items')
];
