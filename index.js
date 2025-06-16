import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();

// Configuração do CORS - Permitir todas as origens para fins de desenvolvimento
app.use(cors());  // Usar CORS sem configuração restritiva
app.use(express.json());

// Variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Cabeçalhos para autenticação no Supabase
const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

// Rota POST /usuarios
app.post('/usuarios', async (req, res) => {
  const { nome, telefone } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }

  try {
    // Buscar usuários por telefone
    const { data: usuariosPorTelefone } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?telefone=eq.${encodeURIComponent(telefone)}`,
      { headers }
    );

    // Buscar usuários por nome exato
    const { data: usuariosPorNome } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?nome=eq.${encodeURIComponent(nome)}`,
      { headers }
    );

    // Verificar se existe usuário com telefone mas nome diferente
    if (usuariosPorTelefone.length > 0) {
      const usuarioExistente = usuariosPorTelefone[0];
      if (usuarioExistente.nome.toLowerCase() !== nome.toLowerCase()) {
        return res.status(400).json({
          error: `Já existe um usuário com este telefone (${telefone}), mas nome diferente.`,
        });
      }

      return res.json({ success: true, usuario: usuarioExistente });
    }

    // Verificar se existe usuário com nome mas outro telefone
    if (usuariosPorNome.length > 0) {
      return res.status(400).json({
        error: `Já existe um usuário com este nome, mas usando outro telefone.`,
      });
    }

    // Se não existir, criar novo usuário
    const { data: novoUsuario } = await axios.post(
      `${SUPABASE_URL}/rest/v1/usuarios_festa`,
      [{ nome, telefone }],
      { headers }
    );

    return res.json({ success: true, usuario: novoUsuario[0] });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao validar ou registrar usuário' });
  }
});

// Rota POST /comidas-usuario
app.post('/comidas-usuario', async (req, res) => {
  const { nome, telefone } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }
  
  try {
    console.log(`Buscando usuário com telefone: ${telefone}`);
    const { data: usuarios } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?telefone=eq.${encodeURIComponent(telefone)}`,
      { headers }
    );

    if (!usuarios || usuarios.length === 0) {
      console.log('Usuário não encontrado');
      return res.status(400).json({ error: 'Usuário não autenticado corretamente' });
    }

    const usuario = usuarios[0];
    if (!usuario.nome || usuario.nome.toLowerCase() !== nome.toLowerCase()) {
      console.log('Nome do usuário não confere');
      return res.status(400).json({ error: 'Usuário não autenticado corretamente' });
    }

    console.log(`Usuário autenticado: ${usuario.nome} (id ${usuario.id})`);

    const { data: comidas } = await axios.get(
      `${SUPABASE_URL}/rest/v1/comidas_festa?order=nome.asc`,
      { headers }
    );

    if (!comidas) {
      console.log('Nenhuma comida encontrada');
      return res.status(404).json({ error: 'Nenhuma comida disponível' });
    }

    const { data: reservas } = await axios.get(
      `${SUPABASE_URL}/rest/v1/reservas_festa`,
      { headers }
    );

    const { data: usuariosReservas } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa`,
      { headers }
    );

    const usuariosMap = new Map();
    usuariosReservas.forEach(u => {
      if(u.id && u.nome) usuariosMap.set(u.id, u.nome);
    });

    const comidasComReserva = comidas.map(comida => {
      if(!comida.id) {
        console.warn('Comida sem id:', comida);
        return null;
      }
      const reservasComida = reservas.filter(r => r.comida_id === comida.id);
      const nomesReservados = reservasComida.map(r => {
        const nomeCompleto = usuariosMap.get(r.usuario_id) || '';
        return nomeCompleto.split(' ')[0];
      });
      const reservado = reservasComida.some(r => r.usuario_id === usuario.id);
      return { ...comida, reservados: nomesReservados, reservado };
    }).filter(Boolean);

    res.json({ comidas: comidasComReserva });

  } catch (error) {
    console.error('Erro no /comidas-usuario:', error.response?.data || error.message || error);
    res.status(500).json({ error: 'Erro ao buscar comidas e reservas' });
  }
});

// Rota para responder a OPTIONS (necessário para CORS)
app.options('*', (req, res) => {
  res.status(200).send();
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend rodando em http://localhost:${PORT}`);
});
