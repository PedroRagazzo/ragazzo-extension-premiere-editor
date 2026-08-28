// Comportamento de abrir/fechar dos cartões de efeito (substitui <details> por um
// grid animável, controlado por uma classe .open no cartão).

(function () {
  var cards = document.querySelectorAll(".effect-card");

  cards.forEach(function (card) {
    var header = card.querySelector(".effect-header");
    if (!header) return;
    header.addEventListener("click", function () {
      card.classList.toggle("open");
    });
  });

  // Liga cada slider (id "X-range") ao seu input numérico irmão (id "X"), nos dois sentidos.
  var ranges = document.querySelectorAll('input[type="range"][id$="-range"]');
  ranges.forEach(function (rangeEl) {
    var numId = rangeEl.id.replace(/-range$/, "");
    var numEl = document.getElementById(numId);
    if (!numEl) return;

    rangeEl.addEventListener("input", function () {
      numEl.value = rangeEl.value;
      numEl.dispatchEvent(new Event("change"));
    });
    numEl.addEventListener("input", function () {
      var v = parseFloat(numEl.value);
      if (!isNaN(v)) rangeEl.value = v;
    });
  });
})();
