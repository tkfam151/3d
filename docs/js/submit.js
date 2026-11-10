import { $, fmtSize, LOGO } from './common.js';
import { config, configured, rpc, uploadFile, newToken, safeName, setupNotice } from './db.js';

$('#brand').insertAdjacentHTML('afterbegin', LOGO);
$('#brand').lastChild.textContent = config.SITE_NAME;
document.title = config.SITE_NAME;
$('#max-mb').textContent = config.MAX_MODEL_MB;
if (!configured) setupNotice($('main'));

const form = $('#request-form');
const fileInput = $('#file-input');
let type = 'file';

// Remember the teacher's name/email for next time.
try {
  const saved = JSON.parse(localStorage.getItem('teacher') || '{}');
  if (saved.teacherName) form.teacherName.value = saved.teacherName;
  if (saved.email) form.email.value = saved.email;
} catch { /* storage unavailable */ }

// ----- type switch -----
document.querySelectorAll('[data-type]').forEach((btn) => {
  btn.addEventListener('click', () => {
    type = btn.dataset.type;
    document.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== type; });
    hideError();
  });
});

// ----- file pick / drop -----
const drop = $('#drop');
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  if (ev.dataTransfer.files.length) {
    fileInput.files = ev.dataTransfer.files;
    picked();
  }
});
fileInput.addEventListener('change', picked);
$('#file-clear').addEventListener('click', () => {
  fileInput.value = '';
  $('#file-picked').hidden = true;
  drop.hidden = false;
});

async function picked() {
  const f = fileInput.files[0];
  if (!f) return;
  if (!/\.(stl|3mf)$/i.test(f.name)) { fileInput.value = ''; return showError('Please choose an STL or 3MF file.'); }
  if (f.size > config.MAX_MODEL_MB * 1048576) { fileInput.value = ''; return showError(`That file is too big (max ${config.MAX_MODEL_MB} MB).`); }
  hideError();
  drop.hidden = true;
  $('#file-picked').hidden = false;
  $('#file-name').textContent = f.name;
  $('#file-size').textContent = fmtSize(f.size);
  $('#file-ext').textContent = f.name.split('.').pop().toUpperCase();
  if (!form.title.value) form.title.value = f.name.replace(/\.(stl|3mf)$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 100);
  const { mountViewer } = await import('./viewer.js');
  mountViewer($('#viewer'), f.arrayBuffer(), f.name);
}

// ----- submit -----
function showError(msg) { const e = $('#form-error'); e.textContent = msg; e.hidden = false; }
function hideError() { $('#form-error').hidden = true; }

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  hideError();
  const v = (n) => form[n].value.trim();
  const file = fileInput.files[0];
  if (type === 'file' && !file) return showError('Please attach an STL or 3MF file.');
  if (type === 'idea' && !v('description')) return showError('Please describe what you’d like printed.');
  if (!v('title')) return showError('Please add a short title.');
  if (!v('teacherName')) return showError('Please add your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) return showError('Please enter a valid email so we can send you updates.');

  const btn = $('#submit');
  const prog = $('#progress');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const token = newToken();
    let filePath = null;
    if (type === 'file') {
      prog.hidden = false;
      prog.textContent = `Uploading ${fmtSize(file.size)}…`;
      filePath = `${token}/${safeName(file.name)}`;
      await uploadFile(filePath, file, /\.3mf$/i.test(file.name) ? 'model/3mf' : 'model/stl');
      prog.textContent = 'Almost done…';
    }
    const res = await rpc('submit_request', { p: {
      track_token: token, type,
      teacher_name: v('teacherName'), email: v('email'), title: v('title'),
      color: v('color'), notes: v('notes'),
      description: type === 'idea' ? v('description') : '',
      file_path: filePath, file_name: file && type === 'file' ? file.name : null,
    } });
    try { localStorage.setItem('teacher', JSON.stringify({ teacherName: v('teacherName'), email: v('email') })); } catch { /* ignore */ }
    const trackUrl = `track.html#${token}`;
    $('#done-text').textContent = `Request #${res.number} is in. Updates will come to ${v('email')}. Bookmark your tracking link to follow along.`;
    $('#done-track').href = trackUrl;
    $('#form-card').hidden = true;
    $('#done-card').hidden = false;
    $('#done-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send request';
    prog.hidden = true;
  }
});

$('#done-again').addEventListener('click', () => {
  const keep = { teacherName: form.teacherName.value, email: form.email.value };
  form.reset();
  form.teacherName.value = keep.teacherName;
  form.email.value = keep.email;
  $('#file-clear').click();
  $('#done-card').hidden = true;
  $('#form-card').hidden = false;
  $('#form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
