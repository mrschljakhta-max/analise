import React from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App";
import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
const element=document.getElementById("root");
if(!element)throw new Error("Missing application root");
createRoot(element).render(<React.StrictMode><App/></React.StrictMode>);
