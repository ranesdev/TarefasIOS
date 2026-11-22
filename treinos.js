/* =====================================================
   TREINOS — ciclo A, B, C, folga e repete (JavaScript puro + LocalStorage)

   Chave: "treinos.v1"
   {
     plano: { A: { nome, exercicios: [{ id, nome, series, reps, descanso, obs }] }, B: {...}, C: {...} },
     historico: [{ id, data, dia, nome, exercicios: [{ exId, nome, series: [{ reps, carga }] }] }],  // mais recente primeiro
     sessao: null | { dia, nome, inicio, idx, exercicios: [...] }   // treino em andamento
   }
   ===================================================== */
(() => {
  'use strict';

  const KEY = 'treinos.v1';
  const DIAS = ['A', 'B', 'C'];
  const MAX = 80;
  const $ = (s) => document.querySelector(s);

  /* ---------- Utilitários ---------- */
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const txt = (v, n = MAX) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  const num = (v, min, max, def) => {
    if (v === undefined || v === null || String(v).trim() === '') return def;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  function el(tag, attrs, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f) n.append(f);
    return n;
  }

  const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.4 2.4 4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgCache = {};
  function svg(html) {                      // só recebe ícones fixos (nunca dados do usuário)
    if (!svgCache[html]) {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      svgCache[html] = t.content.firstChild;
    }
    return svgCache[html].cloneNode(true);
  }

  /* ---------- Aviso ---------- */
  let toastTimer = null;
  function avisar(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  /* =====================================================
     DADOS
     ===================================================== */
  const padrao = () => ({
    plano: Object.fromEntries(DIAS.map((d) => [d, { nome: `Treino ${d}`, exercicios: [] }])),
    historico: [],
    sessao: null,
  });

  function sanear(d) {
    const base = padrao();
    if (!d || typeof d !== 'object') return base;

    for (const k of DIAS) {
      const p = d.plano && d.plano[k];
      if (!p) continue;
      base.plano[k].nome = txt(p.nome, 40) || `Treino ${k}`;
      const usados = new Set();
      base.plano[k].exercicios = (Array.isArray(p.exercicios) ? p.exercicios : [])
        .filter((e) => e && txt(e.nome))
        .slice(0, 60)
        .map((e) => {
          let id = txt(e.id, 24) || novoId();
          while (usados.has(id)) id = novoId();
          usados.add(id);
          return {
            id,
            nome: txt(e.nome),
            series: Math.round(num(e.series, 1, 12, 3)),
            reps: txt(e.reps, 12) || '10',
            descanso: Math.round(num(e.descanso, 0, 600, 60)),
            obs: txt(e.obs, 200),
          };
        });
    }

    base.historico = (Array.isArray(d.historico) ? d.historico : [])
      .filter((h) => h && Number.isFinite(h.data) && DIAS.includes(h.dia))
      .slice(0, 2000)
      .map((h) => ({
        id: txt(h.id, 24) || novoId(),
        data: h.data,
        dia: h.dia,
        nome: txt(h.nome, 40),
        exercicios: (Array.isArray(h.exercicios) ? h.exercicios : []).slice(0, 60).map((e) => ({
          exId: txt(e && e.exId, 24),
          nome: txt(e && e.nome),
          series: (Array.isArray(e && e.series) ? e.series : []).slice(0, 20)
            .map((s) => ({ reps: num(s && s.reps, 0, 999, 0), carga: num(s && s.carga, 0, 999, 0), aq: !!(s && s.aq) })),
        })),
      }))
      .sort((a, b) => b.data - a.data);

    const s = d.sessao;
    if (s && DIAS.includes(s.dia) && Array.isArray(s.exercicios) && s.exercicios.length) {
      const exs = s.exercicios.slice(0, 60).map((e) => ({
        exId: txt(e && e.exId, 24),
        nome: txt(e && e.nome) || 'Exercício',
        reps: txt(e && e.reps, 12),
        descanso: Math.round(num(e && e.descanso, 0, 600, 60)),
        obs: txt(e && e.obs, 200),
        anterior: txt(e && e.anterior, 60),
        series: (Array.isArray(e && e.series) ? e.series : []).slice(0, 20)
          .map((x) => ({ reps: txt(x && x.reps, 4), carga: txt(x && x.carga, 6), feita: !!(x && x.feita), aq: !!(x && x.aq) })),
      }));
      base.sessao = {
        dia: s.dia,
        nome: txt(s.nome, 40),
        inicio: Number.isFinite(s.inicio) ? s.inicio : Date.now(),
        idx: Math.min(exs.length - 1, Math.round(num(s.idx, 0, 59, 0))),
        exercicios: exs,
      };
    }
    return base;
  }

  function carregar() {
    let bruto = null;
    try { bruto = localStorage.getItem(KEY); } catch (e) {
      avisar('Armazenamento indisponível: nada será salvo.');
      return padrao();
    }
    if (bruto === null) return padrao();
    try { return sanear(JSON.parse(bruto)); } catch (e) {
      try { localStorage.setItem(KEY + '.corrompido', bruto); } catch (_) { /* ignora */ }
      avisar('Dados ilegíveis. Uma cópia foi guardada e o app iniciou vazio.');
      return padrao();
    }
  }

  let estado = carregar();

  function salvar() {
    try { localStorage.setItem(KEY, JSON.stringify(estado)); return true; } catch (e) {
      avisar('Não foi possível salvar. Verifique o armazenamento do Safari.');
      return false;
    }
  }

  /* ---------- Datas ---------- */
  const inicioDia = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diffDias = (a, b) => Math.round((inicioDia(a) - inicioDia(b)) / 86400000);
  const rotuloData = (t) => new Date(t).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

  /* =====================================================
     CICLO: A → B → C → folga → A
     Baseado no último treino concluído (e não no dia da semana)
     ===================================================== */
  function proximo() {
    const ult = estado.historico[0];
    if (!ult) return { prox: 'A', pos: 0, folga: false, hoje: false };
    const dd = diffDias(Date.now(), ult.data);
    const i = DIAS.indexOf(ult.dia);
    if (i < 2) return { prox: DIAS[i + 1], pos: i + 1, folga: false, hoje: dd === 0 };
    if (dd <= 1) return { prox: 'A', pos: 3, folga: true, hoje: dd === 0 };   // depois do C vem a folga
    return { prox: 'A', pos: 0, folga: false, hoje: false };
  }

  const minutosEstimados = (pl) =>
    Math.round(pl.exercicios.reduce((t, e) => t + e.series * (40 + e.descanso), 0) / 60);

  /* =====================================================
     ESTADO DE TELA
     ===================================================== */
  let abaAtual = 0;
  let escolhido = null;            // letra escolhida manualmente na faixa (null = automático)
  const histAberto = new Set();
  let editDia = 'A';
  let editEx = null;               // id do exercício em edição (null = novo)

  /* =====================================================
     TELA "HOJE"
     ===================================================== */
  function renderHoje() {
    const c = $('#hoje-conteudo');
    const p = proximo();
    const dia = escolhido || p.prox;
    const pl = estado.plano[dia];
    const frag = document.createDocumentFragment();

    // Faixa do ciclo
    const faixa = el('div', { class: 'strip' });
    [...DIAS, 'Folga'].forEach((l, i) => {
      const cls = 'strip-item' + (i < p.pos ? ' feito' : '') + (i === p.pos ? ' atual' : '')
        + (l === 'Folga' ? ' folga' : '') + (escolhido === l ? ' sel' : '');
      faixa.append(l === 'Folga'
        ? el('div', { class: cls, text: l })
        : el('button', { class: cls, type: 'button', 'data-act': 'escolher', 'data-dia': l, 'aria-label': `Treino ${l}`, text: l }));
    });
    frag.append(faixa);

    // Cartão principal
    const card = el('article', { class: 'card card-pad' });
    if (estado.sessao) {
      const s = estado.sessao;
      const feitas = s.exercicios.reduce((t, e) => t + e.series.filter((x) => x.feita).length, 0);
      const total = s.exercicios.reduce((t, e) => t + e.series.length, 0);
      card.append(
        el('p', { class: 'next-rotulo', text: 'Em andamento' }),
        el('p', { class: 'next-titulo', text: `Treino ${s.dia}` }),
        el('p', { class: 'next-info', text: `${s.nome} · ${feitas} de ${total} séries feitas` }),
        el('button', { class: 'btn-primary btn-block', type: 'button', 'data-act': 'continuar', text: 'Continuar treino' })
      );
    } else {
      const n = pl.exercicios.length;
      if (p.folga && !escolhido) card.append(el('p', { class: 'nota', text: p.hoje ? 'Treino concluído hoje. Amanhã é dia de folga.' : 'Hoje é dia de folga. Descanse bem.' }));
      else if (p.hoje && !escolhido) card.append(el('p', { class: 'nota', text: 'Você já treinou hoje.' }));
      card.append(
        el('p', { class: 'next-rotulo', text: escolhido ? 'Treino escolhido' : (p.folga ? 'Depois da folga' : 'Próximo treino') }),
        el('p', { class: 'next-titulo', text: `Treino ${dia}` }),
        el('p', { class: 'next-info', text: n ? `${pl.nome} · ${plural(n, 'exercício', 'exercícios')} · cerca de ${minutosEstimados(pl)} min` : 'Ainda sem exercícios. Monte este treino.' })
      );
      if (n) {
        const chips = el('div', { class: 'chips' });
        pl.exercicios.slice(0, 3).forEach((e) => chips.append(el('span', { class: 'chip', text: e.nome })));
        if (n > 3) chips.append(el('span', { class: 'chip', text: `+${n - 3}` }));
        card.append(chips);
      }
      card.append(el('button', {
        class: 'btn-primary btn-block', type: 'button', 'data-act': n ? 'iniciar' : 'editar', 'data-dia': dia,
        text: n ? (p.folga && !escolhido ? 'Treinar mesmo assim' : 'Iniciar treino') : 'Montar este treino',
      }));
    }
    frag.append(card);

    // Semana (segunda a domingo)
    const hoje = new Date();
    const seg = inicioDia(hoje.getTime()) - ((hoje.getDay() + 6) % 7) * 86400000;
    const semana = el('div', { class: 'week' });
    let treinosSemana = 0;
    for (let i = 0; i < 7; i++) {
      const ini = new Date(seg); ini.setDate(ini.getDate() + i);
      const t0 = ini.getTime();
      const fez = estado.historico.some((h) => diffDias(h.data, t0) === 0);
      if (fez) treinosSemana++;
      semana.append(el('div', { class: 'week-dia' + (fez ? ' feito' : '') + (diffDias(Date.now(), t0) === 0 ? ' hoje' : '') },
        el('div', { class: 'week-barra' }),
        el('span', { text: 'SEGTERQUAQUISEXSÁBDOM'.slice(i * 3, i * 3 + 3).slice(0, 1) })));
    }
    frag.append(el('p', { class: 'secao-titulo', text: `Esta semana · ${plural(treinosSemana, 'treino', 'treinos')}` }), semana);

    c.replaceChildren(frag);
    $('#resumo').textContent = estado.sessao ? `Treino ${estado.sessao.dia} em andamento`
      : (p.folga && !escolhido ? 'Hoje é folga' : `Próximo: Treino ${dia}`);
    $('#data-hoje').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* =====================================================
     TELA "PLANO"
     ===================================================== */
  function renderPlano() {
    const frag = document.createDocumentFragment();
    for (const d of DIAS) {
      const pl = estado.plano[d];
      frag.append(el('article', { class: 'card' },
        el('div', { class: 'linha-card', 'data-act': 'editar', 'data-dia': d, role: 'button', tabindex: '0' },
          el('div', { class: 'letra', text: d }),
          el('div', { class: 'linha-texto' },
            el('div', { class: 'linha-titulo', text: pl.nome }),
            el('div', { class: 'linha-sub', text: pl.exercicios.length ? `${plural(pl.exercicios.length, 'exercício', 'exercícios')} · cerca de ${minutosEstimados(pl)} min` : 'Toque para adicionar exercícios' })),
          el('span', { class: 'seta', 'aria-hidden': 'true', text: '›' }))));
    }
    frag.append(el('p', { class: 'dica', text: 'O ciclo é A, B, C, folga e repete. A página sempre mostra o próximo treino com base no último que você concluiu.' }));
    $('#plano-lista').replaceChildren(frag);
  }

  /* =====================================================
     TELA "HISTÓRICO"
     ===================================================== */
  const volume = (h) => h.exercicios.reduce((t, e) => t + e.series.reduce((u, s) => u + (s.aq ? 0 : s.reps * s.carga), 0), 0);

  let grafKey = '';
  const NS = 'http://www.w3.org/2000/svg';
  const dataCurta = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const chaveEx = (e) => e.exId || e.nome.toLowerCase();

  function blocoEvolucao() {
    const mapa = new Map();
    for (const h of [...estado.historico].reverse()) for (const e of h.exercicios) mapa.set(chaveEx(e), e.nome);
    if (!mapa.size) return null;
    if (!mapa.has(grafKey)) grafKey = mapa.keys().next().value;
    const sel = el('select', { id: 'graf-ex', 'aria-label': 'Exercício' });
    for (const [k, n] of mapa) sel.append(el('option', { value: k, text: n }));
    sel.value = grafKey;
    return el('article', { class: 'card card-pad evolucao' },
      el('p', { class: 'form-titulo', text: 'Evolução da carga' }),
      el('label', { class: 'field' }, el('span', { text: 'Exercício' }), sel),
      el('div', { id: 'graf-area' }));
  }

  function renderHist() {
    const frag = document.createDocumentFragment();
    const bloco = blocoEvolucao();
    if (bloco) frag.append(bloco);
    if (!estado.historico.length) frag.append(el('p', { class: 'vazio', text: 'Nenhum treino concluído ainda.' }));
    const recs = calcularRecordes();
    for (const h of estado.historico) {
      const aberto = histAberto.has(h.id);
      const nSeries = h.exercicios.reduce((t, e) => t + trabalho(e).length, 0);
      const vol = Math.round(volume(h));
      const r = recs.get(h.id);
      const card = el('article', { class: 'card' },
        el('div', { class: 'hist-topo', 'data-act': 'hist', 'data-id': h.id, role: 'button', tabindex: '0', 'aria-expanded': String(aberto) },
          el('div', { class: 'letra', text: h.dia }),
          el('div', { class: 'linha-texto' },
            el('div', { class: 'linha-titulo', text: rotuloData(h.data) }),
            el('div', { class: 'linha-sub', text: `${h.nome || `Treino ${h.dia}`} · ${plural(nSeries, 'série', 'séries')}${vol ? ` · ${vol.toLocaleString('pt-BR')} kg` : ''}${r ? ` · ★ ${r.length}` : ''}` })),
          el('span', { class: 'seta', 'aria-hidden': 'true', text: aberto ? '⌃' : '⌄' })));
      if (aberto) {
        const det = el('div', { class: 'hist-detalhe' });
        h.exercicios.forEach((e) => det.append(el('div', { class: 'hist-ex' },
          el('div', { class: 'hist-ex-nome', text: e.nome }),
          el('div', { class: 'hist-series', text: e.series.map((s) => `${s.aq ? 'aq ' : ''}${s.reps}×${s.carga ? fmt(s.carga) + ' kg' : 'livre'}`).join('  ·  ') }))));
        if (r) r.forEach((x) => det.append(el('div', { class: 'pr-linha', text: `★ Recorde em ${x.nome}: ${fmt(x.carga)} kg` })));
        det.append(el('button', { class: 'link-del', type: 'button', 'data-act': 'hist-del', 'data-id': h.id, text: 'Excluir este treino' }));
        card.append(det);
      }
      frag.append(card);
    }
    frag.append(el('button', { class: 'btn-sec btn-block', type: 'button', 'data-act': 'backup', text: 'Backup dos dados' }));
    $('#hist-lista').replaceChildren(frag);
    atualizarGrafico();
  }

  $('#hist-lista').addEventListener('change', (e) => {
    if (e.target.id === 'graf-ex') { grafKey = e.target.value; atualizarGrafico(); }
  });

  function renderTudo() { renderHoje(); renderPlano(); renderHist(); }

  /* ---------- Eventos das três listas (delegação) ---------- */
  function achaAct(e) { return e.target.closest('[data-act]'); }

  $('#hoje-conteudo').addEventListener('click', (e) => {
    const b = achaAct(e);
    if (!b) return;
    const dia = b.dataset.dia;
    switch (b.dataset.act) {
      case 'escolher':
        escolhido = escolhido === dia ? null : dia;
        renderHoje();
        break;
      case 'iniciar': iniciarSessao(dia); break;
      case 'continuar': abrirSessao(); break;
      case 'editar': abrirEditor(dia); break;
    }
  });

  $('#plano-lista').addEventListener('click', (e) => {
    const b = achaAct(e);
    if (b && b.dataset.act === 'editar' && DIAS.includes(b.dataset.dia)) abrirEditor(b.dataset.dia);
  });

  $('#hist-lista').addEventListener('click', (e) => {
    const b = achaAct(e);
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'hist') {
      histAberto.has(id) ? histAberto.delete(id) : histAberto.add(id);
      renderHist();
    } else if (b.dataset.act === 'hist-del') {
      if (!window.confirm('Excluir este treino do histórico?')) return;
      estado.historico = estado.historico.filter((h) => h.id !== id);
      histAberto.delete(id);
      salvar(); renderTudo();
    } else if (b.dataset.act === 'backup') abrirBackup();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-act]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  /* =====================================================
     EDITOR DO TREINO
     ===================================================== */
  const telaEditor = $('#tela-editor');

  function abrirEditor(dia) {
    editDia = dia;
    editEx = null;
    $('#ed-titulo').textContent = `Treino ${dia}`;
    $('#ed-nome').value = estado.plano[dia].nome;
    limparForm();
    renderEditor();
    telaEditor.classList.add('open');
    telaEditor.setAttribute('aria-hidden', 'false');
  }

  function fecharEditor() {
    telaEditor.classList.remove('open');
    telaEditor.setAttribute('aria-hidden', 'true');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    renderTudo();
  }

  function limparForm() {
    editEx = null;
    $('#ex-nome').value = '';
    $('#ex-series').value = '3';
    $('#ex-reps').value = '10';
    $('#ex-desc').value = '60';
    $('#ex-obs').value = '';
    $('#ed-form-titulo').textContent = 'Novo exercício';
    $('#ex-salvar').textContent = 'Adicionar';
    $('#ex-cancelar').hidden = true;
  }

  function renderEditor() {
    const lista = estado.plano[editDia].exercicios;
    const frag = document.createDocumentFragment();
    if (!lista.length) frag.append(el('p', { class: 'vazio', text: 'Nenhum exercício ainda. Adicione o primeiro abaixo.' }));
    lista.forEach((ex, i) => {
      frag.append(el('article', { class: 'card' },
        el('div', { class: 'ex-linha' },
          el('div', { class: 'linha-texto', 'data-act': 'ex-editar', 'data-id': ex.id, role: 'button', tabindex: '0' },
            el('div', { class: 'linha-titulo', text: ex.nome }),
            el('div', { class: 'linha-sub', text: `${ex.series} × ${ex.reps} · descanso ${ex.descanso} s${ex.obs ? ' · ' + ex.obs : ''}` })),
          i > 0 ? el('button', { class: 'mini', type: 'button', 'data-act': 'ex-sobe', 'data-id': ex.id, 'aria-label': 'Mover para cima', text: '↑' }) : el('span', { class: 'mini' }),
          i < lista.length - 1 ? el('button', { class: 'mini', type: 'button', 'data-act': 'ex-desce', 'data-id': ex.id, 'aria-label': 'Mover para baixo', text: '↓' }) : el('span', { class: 'mini' }),
          el('button', { class: 'mini danger', type: 'button', 'data-act': 'ex-del', 'data-id': ex.id, 'aria-label': 'Excluir exercício', text: '✕' }))));
    });
    $('#ed-lista').replaceChildren(frag);
  }

  $('#ed-lista').addEventListener('click', (e) => {
    const b = achaAct(e);
    if (!b) return;
    const lista = estado.plano[editDia].exercicios;
    const i = lista.findIndex((x) => x.id === b.dataset.id);
    if (i < 0) return;
    switch (b.dataset.act) {
      case 'ex-sobe': if (i > 0) [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]]; break;
      case 'ex-desce': if (i < lista.length - 1) [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]]; break;
      case 'ex-del':
        if (!window.confirm(`Excluir "${lista[i].nome}"?`)) return;
        lista.splice(i, 1);
        if (editEx === b.dataset.id) limparForm();
        break;
      case 'ex-editar': {
        const ex = lista[i];
        editEx = ex.id;
        $('#ex-nome').value = ex.nome;
        $('#ex-series').value = String(ex.series);
        $('#ex-reps').value = ex.reps;
        $('#ex-desc').value = String(ex.descanso);
        $('#ex-obs').value = ex.obs;
        $('#ed-form-titulo').textContent = 'Editar exercício';
        $('#ex-salvar').textContent = 'Salvar';
        $('#ex-cancelar').hidden = false;
        $('#ex-nome').focus();
        return;
      }
      default: return;
    }
    salvar();
    renderEditor();
  });

  $('#ed-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = txt($('#ex-nome').value);
    if (!nome) { $('#ex-nome').focus(); return; }
    const dados = {
      nome,
      series: Math.round(num($('#ex-series').value, 1, 12, 3)),
      reps: txt($('#ex-reps').value, 12) || '10',
      descanso: Math.round(num($('#ex-desc').value, 0, 600, 60)),
      obs: txt($('#ex-obs').value, 200),
    };
    const lista = estado.plano[editDia].exercicios;
    if (editEx) {
      const ex = lista.find((x) => x.id === editEx);
      if (ex) Object.assign(ex, dados);
    } else {
      if (lista.length >= 60) { avisar('Limite de 60 exercícios por treino.'); return; }
      lista.push({ id: novoId(), ...dados });
    }
    salvar();
    limparForm();
    renderEditor();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });

  $('#ex-cancelar').addEventListener('click', limparForm);
  $('#ed-voltar').addEventListener('click', fecharEditor);
  $('#ed-nome').addEventListener('input', () => {
    estado.plano[editDia].nome = txt($('#ed-nome').value, 40) || `Treino ${editDia}`;
    salvar();
  });

  /* =====================================================
     TREINO EM ANDAMENTO
     ===================================================== */
  /* =====================================================
     HISTÓRICO POR EXERCÍCIO: recordes, sugestão de carga e gráfico
     Séries de aquecimento (aq) não entram em volume, recorde, sugestão nem gráfico.
     ===================================================== */
  const trabalho = (e) => e.series.filter((s) => !s.aq);
  const idDe = (e) => e.id || e.exId || '';

  function achaExec(h, ex) {
    const id = idDe(ex), nome = String(ex.nome || '').toLowerCase();
    return h.exercicios.find((x) => (id && x.exId === id) || x.nome.toLowerCase() === nome) || null;
  }

  function recordeAnterior(ex) {             // maior carga já registrada (só séries válidas)
    let max = 0;
    for (const h of estado.historico) {
      const e = achaExec(h, ex);
      if (e) for (const s of trabalho(e)) if (s.reps > 0 && s.carga > max) max = s.carga;
    }
    return max;
  }

  function calcularRecordes() {              // id do treino -> [{ nome, carga }] que bateram recorde
    const mapa = new Map(), maximos = new Map();
    for (const h of [...estado.historico].sort((a, b) => a.data - b.data)) {
      const lista = [];
      for (const e of h.exercicios) {
        const k = e.exId || e.nome.toLowerCase();
        const melhor = Math.max(0, ...trabalho(e).filter((s) => s.reps > 0).map((s) => s.carga));
        const ant = maximos.get(k) || 0;
        if (ant > 0 && melhor > ant) lista.push({ nome: e.nome, carga: melhor });
        if (melhor > ant) maximos.set(k, melhor);
      }
      if (lista.length) mapa.set(h.id, lista);
    }
    return mapa;
  }

  const alvoReps = (r) => { const n = (String(r).match(/\d+/g) || []).map(Number); return n.length ? Math.max(...n) : 0; };

  // Progressão: completou todas as séries e repetições alvo nas 2 últimas vezes => +2,5 kg
  function sugestao(ex) {
    const alvo = alvoReps(ex.reps);
    if (!alvo || !estado.sessao) return null;
    const plano = estado.plano[estado.sessao.dia].exercicios.find((x) => x.id === ex.exId);
    const necessarias = plano ? plano.series : trabalho(ex).length;
    const execs = [];
    for (const h of estado.historico) {
      const e = achaExec(h, ex);
      if (e) { const w = trabalho(e); if (w.length) execs.push(w); }
      if (execs.length === 2) break;
    }
    if (execs.length < 2) return null;
    const bom = execs.every((w) => w.length >= necessarias && w.every((s) => s.reps >= alvo && s.carga > 0));
    if (!bom) return null;
    const cargas = execs.map((w) => Math.max(...w.map((s) => s.carga)));
    if (cargas[0] < cargas[1]) return null;     // a carga caiu: não sugere subir
    return { carga: cargas[0] + 2.5, base: cargas[0] };
  }

  function sv(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    return n;
  }

  function desenharGrafico(pts) {
    const W = 320, H = 150, mL = 36, mR = 12, mT = 12, mB = 24;
    const g = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico', role: 'img', 'aria-label': 'Evolução da carga ao longo dos treinos' });
    let min = Math.min(...pts.map((p) => p.carga)), max = Math.max(...pts.map((p) => p.carga));
    if (min === max) { min = Math.max(0, min - 5); max += 5; }
    const folga = (max - min) * 0.1;
    min = Math.max(0, min - folga); max += folga;
    const x = (i) => mL + (i / (pts.length - 1)) * (W - mL - mR);
    const y = (v) => mT + (1 - (v - min) / (max - min)) * (H - mT - mB);
    for (let k = 0; k < 3; k++) {
      const v = min + ((max - min) * k) / 2, yy = y(v);
      g.append(sv('line', { x1: mL, x2: W - mR, y1: yy.toFixed(1), y2: yy.toFixed(1), class: 'graf-eixo' }));
      const tx = sv('text', { x: mL - 4, y: (yy + 3).toFixed(1), 'text-anchor': 'end', class: 'graf-txt' });
      tx.textContent = fmt(Math.round(v * 10) / 10);
      g.append(tx);
    }
    g.append(sv('polyline', { points: pts.map((p, i) => `${x(i).toFixed(1)},${y(p.carga).toFixed(1)}`).join(' '), class: 'graf-linha' }));
    pts.forEach((p, i) => g.append(sv('circle', { cx: x(i).toFixed(1), cy: y(p.carga).toFixed(1), r: i === pts.length - 1 ? 4.5 : 3, class: 'graf-ponto' })));
    const d0 = sv('text', { x: mL, y: H - 6, 'text-anchor': 'start', class: 'graf-txt' });
    d0.textContent = dataCurta(pts[0].data);
    const d1 = sv('text', { x: W - mR, y: H - 6, 'text-anchor': 'end', class: 'graf-txt' });
    d1.textContent = dataCurta(pts[pts.length - 1].data);
    g.append(d0, d1);
    return g;
  }

  function atualizarGrafico() {
    const area = $('#graf-area');
    if (!area) return;
    const pts = [];
    for (const h of [...estado.historico].reverse()) {
      const e = h.exercicios.find((z) => chaveEx(z) === grafKey);
      if (!e) continue;
      const cs = trabalho(e).filter((s) => s.reps > 0 && s.carga > 0).map((s) => s.carga);
      if (cs.length) pts.push({ data: h.data, carga: Math.max(...cs) });
    }
    const ult = pts.slice(-30);
    if (ult.length < 2) {
      area.replaceChildren(el('p', { class: 'graf-resumo', text: ult.length ? 'Faça mais um treino com este exercício para ver a evolução.' : 'Sem cargas registradas para este exercício.' }));
      return;
    }
    const p0 = ult[0].carga, p1 = ult[ult.length - 1].carga, dif = Math.round((p1 - p0) * 100) / 100;
    area.replaceChildren(
      desenharGrafico(ult),
      el('p', { class: 'graf-resumo', text: `De ${fmt(p0)} kg para ${fmt(p1)} kg (${dif > 0 ? '+' : ''}${fmt(dif)} kg) em ${plural(ult.length, 'treino', 'treinos')}. Recorde: ${fmt(Math.max(...ult.map((p) => p.carga)))} kg.` }));
  }

  const telaSessao = $('#tela-sessao');
  let descansoFim = 0;
  let tickId = null;
  let wake = null;
  const prAvisado = new Set();     // evita repetir o aviso de recorde na mesma sessão

  function ultimaExecucao(ex) {
    for (const h of estado.historico) {
      const e = achaExec(h, ex);
      if (e) { const w = trabalho(e); if (w.length) return { series: w }; }
    }
    return null;
  }

  function iniciarSessao(dia) {
    const pl = estado.plano[dia];
    if (!pl.exercicios.length) { abrirEditor(dia); return; }
    prAvisado.clear();
    estado.sessao = {
      dia, nome: pl.nome, inicio: Date.now(), idx: 0,
      exercicios: pl.exercicios.map((ex) => {
        const ant = ultimaExecucao(ex);
        const repsPad = String(parseInt(ex.reps, 10) || '');
        const ult = ant ? ant.series.filter((s) => s.carga > 0).slice(-1)[0] : null;
        return {
          exId: ex.id, nome: ex.nome, reps: ex.reps, descanso: ex.descanso, obs: ex.obs,
          anterior: ult ? `${ult.reps}×${fmt(ult.carga)} kg` : '',
          series: Array.from({ length: ex.series }, (_, i) => {
            const a = ant && (ant.series[i] || ant.series[ant.series.length - 1]);
            return { reps: a && a.reps ? String(a.reps) : repsPad, carga: a && a.carga ? fmt(a.carga) : '', feita: false, aq: false };
          }),
        };
      }),
    };
    salvar();
    abrirSessao();
  }

  function abrirSessao() {
    if (!estado.sessao) return;
    renderSessao();
    telaSessao.classList.add('open');
    telaSessao.setAttribute('aria-hidden', 'false');
    clearInterval(tickId);
    tickId = setInterval(tick, 250);
    manterTela();
  }

  function fecharSessao() {
    telaSessao.classList.remove('open');
    telaSessao.setAttribute('aria-hidden', 'true');
    clearInterval(tickId);
    tickId = null;
    descansoFim = 0;
    $('#ss-rest').hidden = true;
    soltarTela();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  const sessaoAberta = () => telaSessao.classList.contains('open');

  async function manterTela() {          // mantém a tela acesa durante o treino (quando o iOS permite)
    try {
      if ('wakeLock' in navigator && !wake) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch (e) { wake = null; }
  }
  function soltarTela() { try { if (wake) wake.release(); } catch (e) { /* ignora */ } wake = null; }

  function renderSessao() {
    const s = estado.sessao;
    if (!s) return;
    const ex = s.exercicios[s.idx];
    const total = s.exercicios.length;
    const nSeries = s.exercicios.reduce((t, e) => t + trabalho(e).length, 0);
    const nFeitas = s.exercicios.reduce((t, e) => t + trabalho(e).filter((x) => x.feita).length, 0);

    $('#ss-info').textContent = `Treino ${s.dia} · ${s.idx + 1} de ${total}`;
    $('#ss-barra').style.width = `${nSeries ? (nFeitas / nSeries) * 100 : 0}%`;
    $('#ss-ant').hidden = s.idx === 0;
    $('#ss-prox').textContent = s.idx === total - 1 ? 'Finalizar treino' : 'Próximo exercício';

    const corpo = $('#ss-corpo');
    const frag = document.createDocumentFragment();
    frag.append(
      el('h3', { class: 'ss-nome', text: ex.nome }),
      el('p', { class: 'ss-meta', text: `${plural(trabalho(ex).length, 'série', 'séries')} · ${ex.reps} repetições · descanso ${ex.descanso} s` })
    );
    if (ex.obs) frag.append(el('p', { class: 'ss-obs', text: ex.obs }));

    const rec = recordeAnterior(ex);
    frag.append(el('p', { class: 'ss-ant', text: (ex.anterior ? `Última vez: ${ex.anterior}` : 'Primeira vez neste exercício.') + (rec ? ` · Recorde: ${fmt(rec)} kg` : '') }));

    const sug = sugestao(ex);
    if (sug && !trabalho(ex).every((x) => num(x.carga, 0, 999, -1) === sug.carga)) {
      frag.append(el('div', { class: 'sug' },
        el('div', { class: 'sug-texto' },
          el('strong', { text: `Sugestão: ${fmt(sug.carga)} kg` }),
          el('span', { text: `Você completou todas as repetições com ${fmt(sug.base)} kg nas 2 últimas vezes.` })),
        el('button', { class: 'act', type: 'button', 'data-act': 'aplicar-sug', text: 'Aplicar' })));
    }

    const feitas = trabalho(ex).filter((x) => x.feita).map((x) => num(x.carga, 0, 999, 0));
    const melhorHoje = feitas.length ? Math.max(...feitas) : 0;
    let marcouPR = false, n = 0;
    const card = el('article', { class: 'card' });
    ex.series.forEach((x, i) => {
      if (!x.aq) n++;
      const c = num(x.carga, 0, 999, 0);
      const pr = !x.aq && x.feita && rec > 0 && c > rec && c === melhorHoje && !marcouPR;
      if (pr) marcouPR = true;
      const rotulo = x.aq ? 'Aquec.' : `Série ${n}`;
      card.append(el('div', { class: 'serie' + (x.feita ? ' feita' : '') + (x.aq ? ' aq' : '') },
        el('button', { class: 'check', type: 'button', 'data-act': 'marca', 'data-i': String(i), 'aria-label': `Marcar ${rotulo}` },
          el('span', { class: 'check-circle' }, svg(ICON_CHECK))),
        el('span', { class: 'serie-rotulo', text: rotulo }, pr ? el('span', { class: 'pr', text: '★ Recorde' }) : null),
        el('input', { class: 'num', type: 'text', inputmode: 'numeric', maxlength: '4', value: x.reps, 'data-f': 'reps', 'data-i': String(i), 'aria-label': `Repetições (${rotulo})`, autocomplete: 'off' }),
        el('span', { class: 'sep-x', text: '×' }),
        el('input', { class: 'num', type: 'text', inputmode: 'decimal', maxlength: '6', value: x.carga, placeholder: 'kg', 'data-f': 'carga', 'data-i': String(i), 'aria-label': `Carga em quilos (${rotulo})`, autocomplete: 'off' }),
        x.aq ? el('button', { class: 'mini danger', type: 'button', 'data-act': 'del-aq', 'data-i': String(i), 'aria-label': 'Remover aquecimento', text: '✕' }) : null));
    });
    frag.append(card);

    const acoes = el('div', { class: 'actions' },
      el('button', { class: 'link-add', type: 'button', 'data-act': 'mais-serie', text: '+ Série' }),
      el('button', { class: 'link-add', type: 'button', 'data-act': 'mais-aq', text: '+ Aquecimento' }));
    if (trabalho(ex).length > 1) acoes.append(el('button', { class: 'link-del', type: 'button', 'data-act': 'menos-serie', text: '− Última' }));
    frag.append(acoes);

    const seguinte = s.exercicios[s.idx + 1];
    frag.append(el('p', { class: 'ss-prox', text: seguinte ? `Próximo: ${seguinte.nome}` : 'Este é o último exercício.' }));
    frag.append(el('button', { class: 'link-del', type: 'button', 'data-act': 'descartar', text: 'Descartar este treino' }));

    corpo.replaceChildren(frag);
  }

  $('#ss-corpo').addEventListener('click', (e) => {
    const b = achaAct(e);
    const s = estado.sessao;
    if (!b || !s) return;
    const ex = s.exercicios[s.idx];
    switch (b.dataset.act) {
      case 'marca': {
        const x = ex.series[Number(b.dataset.i)];
        if (!x) return;
        x.feita = !x.feita;
        if (x.feita && !x.aq) {
          if (ex.descanso > 0) iniciarDescanso(ex.descanso);
          const c = num(x.carga, 0, 999, 0), rec = recordeAnterior(ex), chave = `${s.idx}:${c}`;
          if (rec > 0 && c > rec && !prAvisado.has(chave)) { prAvisado.add(chave); avisar(`Novo recorde em ${ex.nome}: ${fmt(c)} kg ★`); }
        }
        salvar(); renderSessao();
        break;
      }
      case 'aplicar-sug': {
        const sug = sugestao(ex);
        if (sug) ex.series.forEach((x) => { if (!x.aq && !x.feita) x.carga = fmt(sug.carga); });
        salvar(); renderSessao();
        break;
      }
      case 'mais-serie': {
        const w = trabalho(ex), u = w[w.length - 1];
        if (ex.series.length < 20) ex.series.push({ reps: u ? u.reps : '', carga: u ? u.carga : '', feita: false, aq: false });
        salvar(); renderSessao();
        break;
      }
      case 'mais-aq':
        if (ex.series.length < 20) ex.series.unshift({ reps: '', carga: '', feita: false, aq: true });
        salvar(); renderSessao();
        break;
      case 'del-aq': {
        const i = Number(b.dataset.i);
        if (ex.series[i] && ex.series[i].aq) ex.series.splice(i, 1);
        salvar(); renderSessao();
        break;
      }
      case 'menos-serie': {
        let k = ex.series.length - 1;
        while (k >= 0 && ex.series[k].aq) k--;
        if (k >= 0 && trabalho(ex).length > 1) ex.series.splice(k, 1);
        salvar(); renderSessao();
        break;
      }
      case 'descartar':
        if (window.confirm('Descartar este treino? As séries marcadas serão perdidas.')) descartarSessao();
        break;
    }
  });

  $('#ss-corpo').addEventListener('input', (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    const s = estado.sessao;
    if (!f || !s) return;
    const x = s.exercicios[s.idx].series[Number(e.target.dataset.i)];
    if (!x) return;
    x[f] = txt(e.target.value, f === 'reps' ? 4 : 6);
    salvar();
  });

  function irExercicio(delta) {
    const s = estado.sessao;
    if (!s) return;
    s.idx = Math.max(0, Math.min(s.exercicios.length - 1, s.idx + delta));
    salvar(); renderSessao();
    $('#ss-corpo').scrollTop = 0;
  }

  $('#ss-ant').addEventListener('click', () => irExercicio(-1));
  $('#ss-prox').addEventListener('click', () => {
    const s = estado.sessao;
    if (!s) return;
    s.idx === s.exercicios.length - 1 ? finalizarSessao() : irExercicio(1);
  });
  $('#ss-fim').addEventListener('click', finalizarSessao);
  $('#ss-sair').addEventListener('click', () => { fecharSessao(); renderTudo(); avisar('Treino salvo para continuar depois.'); });

  function descartarSessao() {
    estado.sessao = null;
    salvar();
    fecharSessao();
    renderTudo();
  }

  function finalizarSessao() {
    const s = estado.sessao;
    if (!s) return;
    const exs = s.exercicios
      .map((e) => ({
        exId: e.exId, nome: e.nome,
        series: e.series.filter((x) => x.feita).map((x) => ({ reps: num(x.reps, 0, 999, 0), carga: num(x.carga, 0, 999, 0), aq: !!x.aq })),
      }))
      .filter((e) => e.series.length);
    if (!exs.length) {
      if (window.confirm('Nenhuma série foi marcada. Descartar este treino?')) descartarSessao();
      return;
    }
    const novo = { id: novoId(), data: Date.now(), dia: s.dia, nome: s.nome, exercicios: exs };
    estado.historico.unshift(novo);
    estado.sessao = null;
    escolhido = null;
    salvar();
    fecharSessao();
    renderTudo();
    const nRec = (calcularRecordes().get(novo.id) || []).length;
    avisar(nRec ? `Treino salvo. ${plural(nRec, 'recorde', 'recordes')} ★` : 'Treino salvo no histórico.');
  }

  /* ---------- Descanso (usa horário de término: não "congela" se o iOS pausar a página) ---------- */
  function iniciarDescanso(seg) { descansoFim = Date.now() + seg * 1000; tick(); }

  function tick() {
    const r = $('#ss-rest');
    if (!descansoFim) { r.hidden = true; return; }
    const resta = Math.ceil((descansoFim - Date.now()) / 1000);
    r.hidden = false;
    if (resta > 0) {
      $('#ss-tempo').textContent = mmss(resta);
      $('#ss-rotulo').textContent = 'Descanso';
      r.classList.remove('pronto');
    } else {
      $('#ss-tempo').textContent = 'Pronto';
      $('#ss-rotulo').textContent = 'Descanso concluído';
      r.classList.add('pronto');
      if (resta < -6) { descansoFim = 0; r.hidden = true; }
    }
  }

  $('#ss-mais').addEventListener('click', () => { descansoFim = Math.max(descansoFim, Date.now()) + 30000; tick(); });
  $('#ss-pular').addEventListener('click', () => { descansoFim = 0; tick(); });

  /* =====================================================
     BACKUP
     ===================================================== */
  const ovBackup = $('#ov-backup');
  function abrirBackup() {
    $('#bk-texto').value = JSON.stringify({ plano: estado.plano, historico: estado.historico });
    ovBackup.classList.add('open');
    ovBackup.setAttribute('aria-hidden', 'false');
  }
  function fecharBackup() { ovBackup.classList.remove('open'); ovBackup.setAttribute('aria-hidden', 'true'); }

  $('#bk-fechar').addEventListener('click', fecharBackup);
  ovBackup.addEventListener('click', (e) => { if (e.target === ovBackup) fecharBackup(); });

  $('#bk-copiar').addEventListener('click', async () => {
    const t = $('#bk-texto');
    try { await navigator.clipboard.writeText(t.value); avisar('Copiado.'); } catch (e) {
      t.focus(); t.select();
      try { document.execCommand('copy'); avisar('Copiado.'); } catch (_) { avisar('Selecione o texto e copie manualmente.'); }
    }
  });

  $('#bk-importar').addEventListener('click', () => {
    let obj;
    try { obj = JSON.parse($('#bk-texto').value); } catch (e) { avisar('Texto inválido. Cole o backup completo.'); return; }
    if (!obj || typeof obj !== 'object' || !obj.plano) { avisar('Esse texto não parece um backup de treinos.'); return; }
    if (!window.confirm('Substituir o plano e o histórico atuais por este backup?')) return;
    obj.sessao = null;
    estado = sanear(obj);
    salvar();
    fecharBackup();
    renderTudo();
    avisar('Backup importado.');
  });

  /* =====================================================
     ABAS + SWIPE
     ===================================================== */
  const slider = $('#slider');
  function irParaAba(i) {
    abaAtual = Math.max(0, Math.min(2, i));
    slider.style.transform = `translateX(${-abaAtual * (100 / 3)}%)`;
    $('#tab-indicator').style.transform = `translateX(${abaAtual * 100}%)`;
    document.querySelectorAll('.seg').forEach((b, idx) => {
      b.classList.toggle('active', idx === abaAtual);
      b.setAttribute('aria-selected', String(idx === abaAtual));
    });
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (b) irParaAba(Number(b.dataset.tab)); });

  let sx = 0, sy = 0, rastreando = false;
  $('#viewport').addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, select')) { rastreando = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; rastreando = true;
  }, { passive: true });
  $('#viewport').addEventListener('touchend', (e) => {
    if (!rastreando) return;
    rastreando = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) irParaAba(abaAtual + (dx < 0 ? 1 : -1));
  }, { passive: true });

  /* =====================================================
     INICIALIZAÇÃO
     ===================================================== */
  // Teclado do iOS: mantém o campo focado visível e, ao fechar, volta a página ao topo
  document.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('input, textarea')) {
      setTimeout(() => { if (e.target.scrollIntoView) e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
    }
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || !a.matches || !a.matches('input, textarea')) window.scrollTo(0, 0);
    }, 150);
  });

  // Ao voltar para o app: atualiza o dia/ciclo, o timer e a tela acesa
  function aoVoltar() { if (!document.hidden) { renderHoje(); tick(); if (sessaoAberta()) manterTela(); } }
  document.addEventListener('visibilitychange', aoVoltar);
  window.addEventListener('pageshow', aoVoltar);

  // Outra aba alterou os dados (ignora enquanto um treino está aberto aqui)
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || sessaoAberta() || telaEditor.classList.contains('open')) return;
    estado = carregar();
    renderTudo();
  });

  setInterval(() => { if (!document.hidden && !sessaoAberta()) renderHoje(); }, 60000);   // virada de dia

  salvar();
  renderTudo();
  irParaAba(0);
  if (estado.sessao) abrirSessao();      // retoma um treino que ficou aberto

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
