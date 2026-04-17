function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString();
}

updateClock();
setInterval(updateClock, 1000);
