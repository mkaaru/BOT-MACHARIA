
// Disable right-click context menu
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
});

// Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
document.addEventListener('keydown', function(e) {
    // F12
    if (e.keyCode === 123) {
        e.preventDefault();
        return false;
    }
    
    // Ctrl+Shift+I (Developer Tools)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
        e.preventDefault();
        return false;
    }
    
    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
        e.preventDefault();
        return false;
    }
    
    // Ctrl+U (View Source)
    if (e.ctrlKey && e.keyCode === 85) {
        e.preventDefault();
        return false;
    }
    
    // Ctrl+Shift+C (Inspect Element)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 67) {
        e.preventDefault();
        return false;
    }
    
    // Ctrl+Shift+K (Console in Firefox)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 75) {
        e.preventDefault();
        return false;
    }
});

// Disable text selection
document.addEventListener('selectstart', function(e) {
    e.preventDefault();
    return false;
});

// Disable drag and drop
document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

// Detect developer tools
let devtools = {
    open: false,
    orientation: null
};

const threshold = 160;

setInterval(function() {
    if (window.outerHeight - window.innerHeight > threshold || 
        window.outerWidth - window.innerWidth > threshold) {
        if (!devtools.open) {
            devtools.open = true;
            // Redirect or show warning
            document.body.innerHTML = '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;z-index:999999;">Access Denied - Developer Tools Detected</div>';
        }
    } else {
        devtools.open = false;
    }
}, 500);

// Console warning
console.clear();
console.log('%cSTOP!', 'color: red; font-size: 50px; font-weight: bold;');
console.log('%cThis is a browser feature intended for developers. Do not enter any code here.', 'color: red; font-size: 16px;');

// Clear console periodically
setInterval(function() {
    console.clear();
}, 2000);

// Disable print
window.addEventListener('beforeprint', function(e) {
    e.preventDefault();
    return false;
});

// Disable save page
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.keyCode === 83) {
        e.preventDefault();
        return false;
    }
});
