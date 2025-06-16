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

app.post('/comidas/:id/reservar', async (req, res) => {
  const comida_id = req.params.id;
  const { nome, telefone } = req.body;

  if (!nome || !telefone) {
    return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
  }

  try {
    // Busca usuário pelo telefone
    const { data: usuarios } = await axios.get(
      `${SUPABASE_URL}/rest/v1/usuarios_festa?telefone=eq.${encodeURIComponent(telefone)}`,
      { headers }
    );

    if (usuarios.length === 0 || usuarios[0].nome.toLowerCase() !== nome.toLowerCase()) {
      return res.status(400).json({ error: 'Usuário não autenticado corretamente' });
    }
    const usuario = usuarios[0];

    // Busca comida pelo id
    const { data: comidas } = await axios.get(
      `${SUPABASE_URL}/rest/v1/comidas_festa?id=eq.${comida_id}`,
      { headers }
    );
    if (comidas.length === 0) {
      return res.status(404).json({ error: 'Comida não encontrada' });
    }
    const comida = comidas[0];

    if (comida.quantidade_disponivel <= 0) {
      return res.status(400).json({ error: 'Comida esgotada' });
    }

    // Verifica se usuário já reservou esta comida
    const { data: reservasExistentes } = await axios.get(
      `${SUPABASE_URL}/rest/v1/reservas_festa?comida_id=eq.${comida_id}&usuario_id=eq.${usuario.id}`,
      { headers }
    );
    if (reservasExistentes.length > 0) {
      return res.status(400).json({ error: 'Usuário já reservou essa comida' });
    }

    // Cria reserva (envia como array)
    const reserva = [{
      comida_id,
      usuario_id: usuario.id,
      data_reserva: new Date().toISOString(),
      quantidade: 1,
    }];

    const { data, status } = await axios.post(
      `${SUPABASE_URL}/rest/v1/reservas_festa`,
      reserva,
      {
        headers: { ...headers, Prefer: 'return=representation' }
      }
    );

    if (status !== 201) {
      throw new Error('Falha ao criar reserva');
    }

    // Atualiza quantidade disponível da comida (decrementa 1)
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/comidas_festa?id=eq.${comida_id}`,
      { quantidade_disponivel: comida.quantidade_disponivel - 1 },
      { headers }
    );

    res.json({ message: 'Reserva feita com sucesso', reserva: data[0] });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || 'Erro ao reservar comida' });
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
