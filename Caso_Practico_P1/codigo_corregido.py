import sqlite3
import html

MAX_LONGITUD = 50

# Base de datos ficticia con Ana y Bruno
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE alumnos (id INTEGER PRIMARY KEY, nombre TEXT)")
db.execute("INSERT INTO alumnos (nombre) VALUES ('Ana'), ('Bruno')")
db.commit()


# ---------- CÓDIGO CORREGIDO ----------
def validar(nombre):
    if not isinstance(nombre, str) or nombre.strip() == "":
        raise ValueError("El nombre no puede estar vacío")
    if len(nombre) > MAX_LONGITUD:
        raise ValueError("El nombre supera los " + str(MAX_LONGITUD) + " caracteres")
    return nombre.strip()


def buscar(nombre):
    nombre = validar(nombre)
    # Consulta parametrizada: el dato nunca se mezcla con el SQL
    return db.execute(
        "SELECT id, nombre FROM alumnos WHERE nombre = ?", (nombre,)
    ).fetchall()


PLANTILLA = "<h1>{nombre}</h1>"


def mostrar(nombre):
    nombre = validar(nombre)
    # Se escapa el HTML al generar la salida
    return PLANTILLA.format(nombre=html.escape(nombre, quote=True))


# ---------- PRUEBAS ----------
def correr(titulo, nombre):
    print("\n" + titulo)
    print("Entrada:", repr(nombre if len(nombre) < 60 else nombre[:20] + "...(" + str(len(nombre)) + " caracteres)"))
    try:
        print("  buscar  ->", buscar(nombre))
        print("  mostrar ->", mostrar(nombre))
    except ValueError as e:
        print("  rechazada por validación ->", e)


def rechaza(funcion, nombre):
    try:
        funcion(nombre)
    except ValueError:
        return True
    return False


def verificar():
    # Prueba 1 (positiva): nombre válido -> coincidencia correcta
    assert buscar("Ana") == [(1, "Ana")]
    assert buscar("Bruno") == [(2, "Bruno")]
    assert mostrar("Ana") == "<h1>Ana</h1>"

    # Prueba 2 (negativa): apóstrofo -> sin error SQL ni inyección
    assert buscar("O'Brien") == []
    assert buscar("' OR '1'='1") == []
    assert mostrar("O'Brien") == "<h1>O&#x27;Brien</h1>"

    # Prueba 3 (negativa): caracteres HTML -> tratados como contenido
    salida = mostrar("<script>alert(1)</script>")
    assert salida == "<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>"
    assert "<script>" not in salida

    # Prueba 4 (negativa): entrada vacía o excesiva -> rechazada
    assert rechaza(buscar, "")
    assert rechaza(buscar, "   ")
    assert rechaza(buscar, "A" * 200)
    assert rechaza(mostrar, "A" * 200)
    assert not rechaza(buscar, "A" * MAX_LONGITUD)

    print("\nVerificación: todas las pruebas pasaron")


if __name__ == "__main__":
    correr("Prueba 1: nombre válido", "Ana")
    correr("Prueba 2: apóstrofo", "O'Brien")
    correr("Prueba 2b: intento de inyección", "' OR '1'='1")
    correr("Prueba 3: caracteres HTML", "<script>alert(1)</script>")
    correr("Prueba 4a: entrada vacía", "")
    correr("Prueba 4b: entrada excesiva", "A" * 200)
    verificar()
