/**
 * Red de seguridad de las pantallas.
 * Sin esto, cualquier error al dibujar una pantalla deja TODO el sitio en blanco. Con esto, solo esa parte muestra un aviso
 * con botones para reintentar, y el resto de la plataforma sigue funcionando.
 */
import React from "react";

const esErrorDeVersion = (e) => /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically/i.test(String(e && (e.message || e)));

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Queda en la consola del navegador (F12) para poder diagnosticarlo.
    console.error("[Drive Futuro] Error al dibujar la pantalla:", error, info && info.componentStack);
  }

  componentDidUpdate(prev) {
    // Al cambiar de pestaña o de pantalla se vuelve a intentar solo.
    if (this.state.error && prev.clave !== this.props.clave) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const version = esErrorDeVersion(error);
    return (
      <div className="border border-rose-200 bg-rose-50 p-6 text-sm text-stone-800 flex flex-col gap-3" role="alert">
        <p className="font-serif text-lg text-stone-900">{version ? "Hay una versión nueva de la plataforma" : "Esta pantalla tuvo un problema"}</p>
        <p>
          {version
            ? "Mantuviste la pestaña abierta mientras se actualizaba el sistema. Recarga la página para continuar."
            : "El resto de la plataforma sigue funcionando. Puedes reintentar o recargar la página; si se repite, avísanos qué estabas haciendo."}
        </p>
        {!version && <p className="text-xs text-stone-500 font-mono break-words">{String((error && error.message) || error).slice(0, 240)}</p>}
        <div className="flex flex-wrap gap-2">
          {!version && <button onClick={() => this.setState({ error: null })} className="px-4 py-2 text-sm bg-stone-900 text-white hover:bg-stone-800">Reintentar</button>}
          <button onClick={() => window.location.reload()} className="px-4 py-2 text-sm border border-stone-300 bg-white text-stone-700 hover:bg-stone-50">Recargar la página</button>
        </div>
      </div>
    );
  }
}
