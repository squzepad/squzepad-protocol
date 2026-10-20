// Runs before first paint: lets CSS hide reveal targets only when scripting is available,
// and releases them if the app module never reports ready.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  setTimeout(function () {
    if (!root.dataset.ready) root.classList.add('rf');
  }, 3500);
})();
