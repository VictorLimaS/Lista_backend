import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

app.post('/usuarios', async (req, res) => {
  const { nome, telefone } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }

  try {
    // Busca por telefone
    const { data: usuariosPorTelefone } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?telefone=eq.${encodeURIComponent(telefone)}`,
      { headers }
    );

    // Busca por nome exato
    const { data: usuariosPorNome } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?nome=eq.${encodeURIComponent(nome)}`,
      { headers }
    );

    // Se existe o mesmo telefone mas nome diferente → rejeita
    if (usuariosPorTelefone.length > 0) {
      const usuarioExistente = usuariosPorTelefone[0];
      if (usuarioExistente.nome.toLowerCase() !== nome.toLowerCase()) {
        return res.status(400).json({
          error: `Já existe um usuário com este telefone (${telefone}), mas nome diferente.`,
        });
      }

      // Nome e telefone batem → login válido
      return res.json({ success: true, usuario: usuarioExistente });
    }

    // Se existe o mesmo nome mas com outro telefone → rejeita
    if (usuariosPorNome.length > 0) {
      return res.status(400).json({
        error: `Já existe um usuário com este nome, mas usando outro telefone.`,
      });
    }

    // Nome e telefone são novos → cria usuário
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

app.post('/comidas-usuario', async (req, res) => {
  const { nome, telefone } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }
  
  try {
    // Busca usuário
    const { data: usuarios } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?telefone=eq.${encodeURIComponent(telefone)}`,
      { headers }
    );
    if (usuarios.length === 0 || usuarios[0].nome.toLowerCase() !== nome.toLowerCase()) {
      return res.status(400).json({ error: 'Usuário não autenticado corretamente' });
    }
    const usuario = usuarios[0];

    // Busca comidas
    const { data: comidas } = await axios.get(
      `${SUPABASE_URL}/rest/v1/comidas_festa?select=*&order=nome.asc`,
      { headers }
    );

    // Busca reservas do usuário
    const { data: reservas } = await axios.get(
      `${SUPABASE_URL}/rest/v1/reservas_festa?usuario_id=eq.${usuario.id}`,
      { headers }
    );

    // Mapeia comidas, incluindo os primeiros nomes dos usuários que reservaram
    const comidasComReserva = await Promise.all(comidas.map(async (comida) => {
      // Pega as reservas para esta comida
      const { data: reservasComida } = await axios.get(
        `${SUPABASE_URL}/rest/v1/reservas_festa?comida_id=eq.${comida.id}`,
        { headers }
      );

      // Para cada reserva, pega o primeiro nome do usuário
      const nomesReservados = await Promise.all(reservasComida.map(async (reserva) => {
        const { data: usuarioReserva } = await axios.get(
          `${SUPABASE_URL}/rest/v1/usuarios_festa?id=eq.${reserva.usuario_id}`,
          { headers }
        );
        const nomeCompleto = usuarioReserva[0]?.nome;
        const primeiroNome = nomeCompleto ? nomeCompleto.split(' ')[0] : ''; // Pega o primeiro nome
        return primeiroNome;
      }));

      return {
        ...comida,
        reservados: nomesReservados, // Lista de primeiros nomes que reservaram a comida
        reservado: reservas.some(r => r.comida_id === comida.id), // Verifica se o usuário fez a reserva
      };
    }));

    res.json({ comidas: comidasComReserva });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao buscar comidas e reservas' });
  }
});

app.post('/comidas/:id/reservar', async (req, res) => {
  const comida_id = parseInt(req.params.id);
  const { nome, telefone } = req.body;

  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }

  try {
    // Busca usuário pelo telefone
    const { data: usuarios, error: errUser } = await supabase
      .from('usuarios_festa')
      .select('*')
      .eq('telefone', telefone);

    if (errUser || usuarios.length === 0) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const usuario = usuarios[0];

    // Confirma nome igual (case insensitive)
    if (usuario.nome.toLowerCase() !== nome.toLowerCase()) {
      return res.status(400).json({ error: 'Nome não corresponde ao telefone' });
    }

    // Chama a função PL/pgSQL para reserva atômica
    const { error: errRpc } = await supabase.rpc('reservar_comida', {
      p_usuario_id: usuario.id,
      p_comida_id: comida_id,
    });

    if (errRpc) {
      return res.status(400).json({ error: errRpc.message });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Erro no servidor:', error);
    return res.status(500).json({ error: 'Erro ao reservar item' });
  }
});


app.post('/comidas/:id/cancelar', async (req, res) => {
  const comida_id = req.params.id;
  const { nome, telefone } = req.body;

  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }

  try {
    // Busca usuário
    const { data: usuarios } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?telefone=eq.${encodeURIComponent(telefone)}`,
      { headers }
    );
    if (usuarios.length === 0 || usuarios[0].nome.toLowerCase() !== nome.toLowerCase()) {
      return res.status(400).json({ error: 'Usuário não autenticado corretamente' });
    }
    const usuario = usuarios[0];

    // Busca reserva existente
    const { data: reservasExistentes } = await axios.get(
      `${SUPABASE_URL}/rest/v1/reservas_festa?usuario_id=eq.${usuario.id}&comida_id=eq.${comida_id}`,
      { headers }
    );
    if (reservasExistentes.length === 0) {
      return res.status(400).json({ error: 'Reserva não encontrada para cancelar' });
    }
    const reserva = reservasExistentes[0];

    // Deleta a reserva
    await axios.delete(
      `${SUPABASE_URL}/rest/v1/reservas_festa?id=eq.${reserva.id}`,
      { headers }
    );

    // NÃO altera quantidade_disponivel aqui (deixe a lógica que você já tem cuidar disso)

    res.json({ success: true });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao cancelar reserva' });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`✅ Backend rodando em http://localhost:${PORT}`);
});
