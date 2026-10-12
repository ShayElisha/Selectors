try {
  if (localStorage.getItem('gate-out-theme') === 'dark') {
    document.documentElement.classList.add('dark')
    document.documentElement.style.colorScheme = 'dark'
  }
} catch {
  // ThemeProvider applies the stored theme after React loads.
}
