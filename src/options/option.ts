import "../tailwind.css";
import "../assets/loader.css";
import "../assets/success.css";
import { createApp } from "vue";
import Option from "./Option.vue";

const div = document.createElement("div");
div.id = "app";
document.body.appendChild(div);

createApp(Option).mount("#app");
