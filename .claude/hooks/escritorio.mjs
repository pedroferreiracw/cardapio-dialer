// Hook do Claude Code: manda o evento para o Escritório de IA. Nunca falha a sessão.
// node hook.js               → evento para o escritório do PC (roda em segundo plano).
// node hook.js --permissao   → PermissionRequest: espera a resposta dada no escritório (até ~25 s);
//                              sem resposta, o Claude Code pergunta normalmente no terminal / VS Code.
// node escritorio.mjs --so-nuvem → cópia no repositório, para sessões na nuvem: usa ESCRITORIO_URL e
//                              ESCRITORIO_TOKEN do ambiente da nuvem e não faz nada fora dela.
const soNuvem = process.argv.includes('--so-nuvem');
const permissao = process.argv.includes('--permissao');
const url = (process.env.ESCRITORIO_URL || 'http://127.0.0.1:5180').replace(/\/$/, '');
const token = process.env.ESCRITORIO_TOKEN;
if (soNuvem && (process.env.CLAUDE_CODE_REMOTE !== 'true' || !process.env.ESCRITORIO_URL || !token)) process.exit(0);

const corta = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s);
let entrada = '';
process.stdin.on('data', (d) => (entrada += d));
process.stdin.on('end', async () => {
  let e;
  try { e = JSON.parse(entrada); } catch { return; }
  // Só o que o escritório usa: nada de conteúdo de arquivos ou saídas de comandos.
  const i = e.tool_input || {};
  const evento = {
    hook_event_name: e.hook_event_name, session_id: e.session_id, cwd: e.cwd, transcript_path: e.transcript_path,
    agent_id: e.agent_id, agent_type: e.agent_type, source: e.source, notification_type: e.notification_type,
    message: corta(e.message, 300), prompt: corta(e.prompt, 300), last_assistant_message: corta(e.last_assistant_message, 300),
    error: corta(typeof e.error === 'string' ? e.error : e.error?.message, 200), tool_name: e.tool_name,
    tool_input: {
      file_path: i.file_path, notebook_path: i.notebook_path, command: corta(i.command, 300), pattern: corta(i.pattern, 100),
      url: corta(i.url, 200), query: corta(i.query, 100), subagent_type: i.subagent_type, skill: i.skill, name: i.name,
    },
    _env: { entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT, remote: process.env.CLAUDE_CODE_REMOTE === 'true' },
  };
  try {
    const r = await fetch(url + (permissao ? '/api/permissoes' : '/api/eventos'), {
      method: 'POST', body: JSON.stringify(evento), signal: AbortSignal.timeout(permissao ? 28_000 : 3000),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    });
    if (!permissao) return;
    const { decisao } = await r.json();
    if (decisao === 'allow' || decisao === 'deny') {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: decisao === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Recusado pelo Escritório de IA.' } } }));
    }
  } catch { /* escritório desligado ou sem resposta: segue o fluxo normal */ }
});
