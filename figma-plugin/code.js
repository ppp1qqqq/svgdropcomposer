// Основной код плагина: открывает интерфейс сборщика и вставляет готовые
// композиции на холст. Интерфейс (ui.html) - тот же сервис, что и в браузере.

figma.showUI(__html__, { width: 1240, height: 780, title: 'SVG-drop: сборщик иллюстраций' });

figma.ui.onmessage = function (msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'insert-svg') {
    try {
      // Figma сама превращает SVG в слои: каждый объект остаётся отдельной
      // группой с именем из id («Книга», «Наушники-фон»), пути векторные.
      var frame = figma.createNodeFromSvg(msg.svg);
      frame.name = msg.name || 'SVG-drop';
      var center = figma.viewport.center;
      frame.x = Math.round(center.x - frame.width / 2);
      frame.y = Math.round(center.y - frame.height / 2);
      figma.currentPage.appendChild(frame);
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.notify('Композиция добавлена: ' + frame.name);
    } catch (e) {
      figma.notify('Не удалось вставить композицию: ' + (e && e.message ? e.message : e), { error: true });
    }
    return;
  }

  if (msg.type === 'notify' && msg.text) {
    figma.notify(String(msg.text));
    return;
  }

  if (msg.type === 'close') figma.closePlugin();
};
