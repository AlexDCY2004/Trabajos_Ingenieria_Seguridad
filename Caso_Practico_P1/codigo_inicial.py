import sqlite3

# Base de datos ficticia con Ana y Bruno
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE alumnos (id INTEGER PRIMARY KEY, nombre TEXT)")
db.execute("INSERT INTO alumnos (nombre) VALUES ('Ana'), ('Bruno')")
db.commit()


# ---------- CÓDIGO INICIAL (vulnerable) ----------
def buscar(nombre):
    sql = "SELECT id, nombre FROM alumnos WHERE nombre = '" + nombre + "'"
    return db.execute(sql).fetchall()


def mostrar(nombre):
    return "<h1>" + nombre + "</h1>"


# ---------- PRUEBAS ----------
def correr(titulo, nombre):
    print("\n" + titulo)
    print("Entrada:", repr(nombre if len(nombre) < 60 else nombre[:20] + "...(" + str(len(nombre)) + " caracteres)"))
    try:
        print("  buscar  ->", buscar(nombre))
    except Exception as e:
        print("  buscar  -> ERROR SQL:", e)
    print("  mostrar ->", mostrar(nombre)[:80])


if __name__ == "__main__":
    correr("Prueba 1: nombre válido", "Ana")
    correr("Prueba 2: apóstrofo", "O'Brien")
    correr("Prueba 3: caracteres HTML", "<script>alert(1)</script>")
    correr("Prueba 4a: entrada vacía", "")
    correr("Prueba 4b: entrada excesiva", "A" * 200)
