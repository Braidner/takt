import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, pipelineState, staleFrom } from '../studio/compose/pipeline.mjs';

/** Файлы проекта: имя → время правки в секундах. Порядок возрастания = порядок работы. */
const files = (over = {}) => ({
  'prompt.txt': 100, 'recon.json': 200, 'story.md': 300,
  'storyboard.json': 400, 'states.json': 500, 'movie.mp4': 600, ...over,
});

const state = (sb, id) => sb.find((s) => s.id === id);

test('ступени идут в порядке работы и знают, от чего зависят', () => {
  assert.deepEqual(STAGES.map((s) => s.id),
                   ['prompt', 'recon', 'story', 'storyboard', 'states', 'movie']);
  assert.equal(STAGES[0].needs, null);
  assert.equal(state(STAGES, 'states').needs, 'storyboard');
});

test('пустой проект: всё отсутствует и ничего не устарело', () => {
  const sb = pipelineState({ files: {}, approved: [] });
  assert.ok(sb.every((s) => s.state === 'missing'));
  assert.ok(sb.every((s) => !s.stale));
});

test('файл есть, утверждения нет — черновик', () => {
  const sb = pipelineState({ files: files(), approved: [] });
  assert.equal(state(sb, 'story').state, 'draft');
});

test('утверждённая ступень готова', () => {
  const sb = pipelineState({ files: files(), approved: ['story'] });
  assert.equal(state(sb, 'story').state, 'ready');
});

test('утверждение отсутствующей ступени ничего не значит', () => {
  // Флаг мог остаться от прошлой жизни проекта: файл удалили, а отметка осталась.
  const sb = pipelineState({ files: { 'prompt.txt': 100 }, approved: ['story'] });
  assert.equal(state(sb, 'story').state, 'missing');
});

test('ступень старше своего источника — устарела', () => {
  // Раскадровку переписали после того, как по ней сняли: состояния уже не про неё.
  const sb = pipelineState({ files: files({ 'storyboard.json': 550 }), approved: [] });
  assert.equal(state(sb, 'states').stale, true);
  assert.equal(state(sb, 'movie').stale, true, 'устаревание идёт вниз по цепочке');
  assert.equal(state(sb, 'story').stale, false, 'вверх по цепочке ничего не трогается');
});

test('устаревшая ступень остаётся на месте, а не исчезает', () => {
  // Молча стирать чужую работу нельзя: человек мог править её руками час назад.
  const sb = pipelineState({ files: files({ 'storyboard.json': 550 }), approved: ['states'] });
  assert.equal(state(sb, 'states').state, 'ready');
  assert.equal(state(sb, 'states').stale, true);
});

test('пропущенная середина не делает следующую ступень устаревшей', () => {
  // Разведку можно не сохранять: гейт пропускается, и это не повод считать
  // раскадровку испорченной.
  const noRecon = files();
  delete noRecon['recon.json'];
  const sb = pipelineState({ files: noRecon, approved: [] });
  assert.equal(state(sb, 'recon').state, 'missing');
  assert.equal(state(sb, 'storyboard').stale, false);
});

test('gates: false снимает требование утверждения, но не выдумывает файлы', () => {
  const sb = pipelineState({ files: files(), approved: [], gates: false });
  assert.equal(state(sb, 'story').state, 'ready');
  const пусто = pipelineState({ files: {}, approved: [], gates: false });
  assert.ok(пусто.every((s) => s.state === 'missing'));
});

test('перегенерация помечает всё, что ниже, и не трогает то, что выше', () => {
  assert.deepEqual(staleFrom('story'), ['storyboard', 'states', 'movie']);
  assert.deepEqual(staleFrom('movie'), []);
  assert.deepEqual(staleFrom('prompt'), ['recon', 'story', 'storyboard', 'states', 'movie']);
});

test('неизвестная ступень не роняет расчёт', () => {
  assert.deepEqual(staleFrom('его-нет'), []);
});
