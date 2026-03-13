const express = require('express');
const router = express.Router();
const { pedidosController } = require('./controllers');

router.post('/importar', pedidosController);

module.exports = router;
