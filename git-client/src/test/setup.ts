import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// findBy… et waitFor attendent 1 s par défaut. Sous charge (seize workers, une CI lente, un navigateur qui se ferme à
// côté), un rendu asynchrone peut dépasser ce délai : vu sur FileEditorDialog (Échap d'Android), une fois en CI et une
// fois en local. Un test qui réussit n'attend pas plus longtemps ; seul un échec met 5 s à être signalé.
configure({ asyncUtilTimeout: 5000 });
