document.addEventListener("DOMContentLoaded", function () {

    const fadeElements = document.querySelectorAll(".fade");

    function reveal() {
        fadeElements.forEach((item) => {
            const top = item.getBoundingClientRect().top;
            const screenHeight = window.innerHeight;

            if (top < screenHeight - 100) {
                item.classList.add("show");
            }
        });
    }

    window.addEventListener("scroll", reveal);
    reveal();

    const counters = document.querySelectorAll(".counter");

    counters.forEach(counter => {
        counter.innerText = "0";

        const updateCounter = () => {
            const target = +counter.getAttribute("data-target");
            const current = +counter.innerText;
            const increment = target / 100;

            if (current < target) {
                counter.innerText = `${Math.ceil(current + increment)}`;
                setTimeout(updateCounter, 20);
            } else {
                counter.innerText = target;
            }
        };

        updateCounter();
    });
});

const topButton = document.getElementById("topBtn");

window.onscroll = function () {
    if (document.body.scrollTop > 300 || document.documentElement.scrollTop > 300) {
        if (topButton) {
            topButton.style.display = "block";
        }
    } else {
        if (topButton) {
            topButton.style.display = "none";
        }
    }
};

function backToTop() {
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function toggleDarkMode() {
    document.body.classList.toggle("dark");
}

const galleryImages = document.querySelectorAll(".gallery img");

galleryImages.forEach(img => {
    img.addEventListener("click", () => {
        img.classList.toggle("img-fluid");
        img.classList.toggle("shadow-lg");
        img.classList.toggle("border");
    });
});

const links = document.querySelectorAll(".nav-link");

links.forEach(link => {
    link.addEventListener("click", function () {
        links.forEach(item => item.classList.remove("active"));
        this.classList.add("active");
    });
});

window.addEventListener("load", () => {
    const loader = document.getElementById("loader");
    if (loader) {
        loader.style.display = "none";
    }
});

function showMessage() {
    alert("Welcome to Cisco Packet Tracer Portfolio!");
}

const year = document.getElementById("year");

if (year) {
    year.innerHTML = new Date().getFullYear();
}
