/* Elevated — drawn line field. Fills every displayed [data-paths] host with two
   mirrored fans of curves; the drift itself is CSS (stroke-dash keyframes), so
   reduced motion is handled in the stylesheet. Adds .on once drawn so the host
   can fade in, per the brand rule that drawn backgrounds appear only when ready. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  function jitter(i) {
    var v = Math.sin(i + 1) * 10000;
    return v - Math.floor(v);
  }

  function layer(position, count) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 696 316');
    for (var i = 0; i < count; i++) {
      var o = i * 5 * position;
      var d = 'M-' + (380 - o) + ' -' + (189 + i * 6) +
        'C-' + (380 - o) + ' -' + (189 + i * 6) + ' -' + (312 - o) + ' ' + (216 - i * 6) + ' ' + (152 - o) + ' ' + (343 - i * 6) +
        'C' + (616 - o) + ' ' + (470 - i * 6) + ' ' + (684 - o) + ' ' + (875 - i * 6) + ' ' + (684 - o) + ' ' + (875 - i * 6);
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.setAttribute('stroke-width', (0.5 + i * 0.03).toFixed(2));
      p.setAttribute('stroke-opacity', Math.min(1, 0.1 + i * 0.03).toFixed(2));
      p.style.setProperty('--d', (20 + jitter(i) * 10).toFixed(1) + 's');
      p.style.animationDelay = (-jitter(i + count) * 20).toFixed(1) + 's';
      svg.appendChild(p);
    }
    return svg;
  }

  document.querySelectorAll('[data-paths]').forEach(function (host) {
    if (!host.offsetParent) return; // hidden at this breakpoint
    var count = Number(host.dataset.paths) || 36;
    host.appendChild(layer(1, count));
    host.appendChild(layer(-1, count));
    requestAnimationFrame(function () { host.classList.add('on'); });
  });
})();
