// Type-only imports that give tsc the ambient `gi://` module declarations.
// Nothing here is emitted: the actual runtime imports happen in the source
// files via `import X from 'gi://X'`.
import "@girs/gjs/ambient";
import "@girs/gjs/dom";
import "@girs/glib-2.0/ambient";
import "@girs/gio-2.0/ambient";
import "@girs/soup-3.0/ambient";
import "@girs/gtk-4.0/ambient";
import "@girs/adw-1/ambient";
// GNOME Shell UI namespaces (panel indicator / popup, only available in the
// shell process); provided as transitive deps of @girs/gnome-shell.
import "@girs/gobject-2.0/ambient";
import "@girs/clutter-51/ambient";
import "@girs/st-51/ambient";

export {};
