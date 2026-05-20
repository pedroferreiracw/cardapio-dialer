const express = require('express');
const router = express.Router();
const {
  outboundTwiML,
  amdCallback,
  statusCallback,
  dialComplete
} = require('../controllers/twilioController');

router.post('/twiml/outbound', outboundTwiML);
router.get('/twiml/outbound', outboundTwiML);
router.post('/amd', amdCallback);
router.post('/status', statusCallback);
router.post('/dial-complete', dialComplete);

module.exports = router;