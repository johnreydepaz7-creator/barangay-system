/* Barangay document PDF helper - v2026-05-16-print-only-v4
   This opens the browser print dialog only. Choose "Save as PDF" there.
   It intentionally does NOT use html2canvas, jsPDF, canvas snapshots, or image PDFs,
   because image PDFs cause broken spacing like "Certifi cate" / "be ing". */
(function () {
  'use strict';

  function getPdfButton() {
    return Array.from(document.querySelectorAll('button')).find(function (btn) {
      return (btn.getAttribute('onclick') || '').includes('saveAsPDF') || /save\s+as\s+pdf/i.test(btn.textContent || '');
    });
  }

  function forceLightDocumentMode() {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    document.body.style.colorScheme = 'light';
    document.body.classList.add('pdf-printing');

    var paper = document.querySelector('.certificate, .paper');
    if (paper) {
      paper.style.background = '#ffffff';
      paper.style.color = '#000000';
      paper.style.transform = 'none';
      paper.style.filter = 'none';
    }
  }

  function restorePdfButton(button, oldText) {
    setTimeout(function () {
      document.body.classList.remove('pdf-printing');
      if (button) {
        button.disabled = false;
        button.innerHTML = oldText;
      }
    }, 1000);
  }

  window.saveAsPDF = function saveAsPDF() {
    var button = getPdfButton();
    var oldText = button ? button.innerHTML : '';

    if (button) {
      button.disabled = true;
      button.innerHTML = 'Opening Print Dialog...';
    }

    forceLightDocumentMode();

    var waitForFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    var waitForImages = Promise.all(Array.from(document.images).map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.onload = img.onerror = resolve;
      });
    }));

    Promise.all([waitForFonts, waitForImages]).finally(function () {
      setTimeout(function () {
        window.print();
        restorePdfButton(button, oldText);
      }, 250);
    });
  };
})();
