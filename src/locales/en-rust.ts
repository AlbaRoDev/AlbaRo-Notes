// English for the Spanish error texts of the Rust side (src-tauri/src), keyed by the text as Rust writes it, with
// its {placeholders} in the same order. tests/i18n.test.mjs keeps this file in step with the Rust code.
export const enRust: Record<string, string> = {
  "La clave de API no tiene un formato válido": "The API key doesn't have a valid format",
  "El contenido del archivo no es válido": "The file content isn't valid",
  "La IA local no está disponible en el móvil": "Local AI isn't available on a phone",
  "Para usar la IA online hace falta una clave de API": "An API key is needed to use the online AI",
  "Para usar la IA online tienes que aceptar que el texto de tus notas se envíe al servicio":
    "To use the online AI you must accept that the text of your notes is sent to the service",
  "Ruta no válida": "Invalid path",
  "La IA está desactivada. Actívala desde el asistente (Ctrl+J fuera del texto, o «Preguntar a la IA» en la paleta).":
    'The AI is turned off. Turn it on from the assistant (Ctrl+J outside the text, or "Ask the AI" in the palette).',
  "La IA online no está configurada: falta la clave de API o tu consentimiento.":
    "The online AI isn't set up: the API key or your consent is missing.",
  "No se puede conectar con el servicio online. ¿Hay conexión a internet?":
    "Can't connect to the online service. Is there an internet connection?",
  "No se puede conectar con Ollama en este equipo. ¿Está abierto?":
    "Can't connect to Ollama on this computer. Is it open?",
  "Nombre de modelo no válido": "Invalid model name",
  "Ollama devolvió un número de vectores distinto": "Ollama returned a different number of vectors",
  "Id de página no válido: usa un id devuelto por buscar_entradas":
    "Invalid page id: use an id returned by buscar_entradas",
  "No existe ninguna página con ese id": "No page has that id",
  "La base de datos ya no existe": "The database no longer exists",
  "Falta el título de la página": "The page title is missing",
  "El título no puede pasar de {MAX_TITLE} caracteres":
    "The title can't be longer than {MAX_TITLE} characters",
  "El contenido no puede pasar de {MAX_CONTENT} caracteres":
    "The content can't be longer than {MAX_CONTENT} characters",
  "«dentro_de» debe ser el id de una página normal (no de una base de datos ni de una fila)":
    '"dentro_de" must be the id of a normal page (not a database or a row)',
  "«{text}» no es un número": '"{text}" is not a number',
  "«{tag}» no es una etiqueta de «{}». Etiquetas: {}": '"{tag}" is not a tag of "{}". Tags: {}',
  "«{text}» no es sí ni no: para una casilla usa true o false":
    '"{text}" is neither yes nor no: for a checkbox use true or false',
  "Las relaciones no se cambian desde el asistente":
    "Relations can't be changed from the assistant",
  "No hay ninguna fila titulada «{fila}». Búscala con buscar_entradas y usa su id":
    'No row is titled "{fila}". Look it up with buscar_entradas and use its id',
  "Hay varias filas tituladas «{fila}» (ids: {}). Usa el id de la que quieres cambiar":
    'Several rows are titled "{fila}" (ids: {}). Use the id of the one you want to change',
  "Falta «fila»: el id de la fila (de buscar_entradas)":
    '"fila" is missing: the row\'s id (from buscar_entradas)',
  "Falta «propiedad»: el nombre de la columna": '"propiedad" is missing: the name of the column',
  "«fila» no es el id de una fila de base de datos": '"fila" is not the id of a database row',
  "Esa propuesta ya no existe (¿ya se aplicó o descartó?)":
    "That proposal no longer exists (was it already applied or discarded?)",
  "No hay ninguna base de datos en la página abierta: indica «base_de_datos» (su nombre o su id; búscala con buscar_entradas)":
    'There is no database on the open page: give "base_de_datos" (its name or id; look it up with buscar_entradas)',
  "Hay varias bases de datos en la página abierta ({}): indica cuál en «base_de_datos»":
    'There are several databases on the open page ({}): say which one in "base_de_datos"',
  "No existe ninguna base de datos con ese id": "No database has that id",
  "No hay ninguna base de datos llamada «{a}». Hay: {}":
    'No database is called "{a}". There are: {}',
  "Hay varias bases de datos llamadas «{a}» (ids: {}). Usa el id":
    'Several databases are called "{a}" (ids: {}). Use the id',
  "«{wanted}» no es una fila de «{}»": '"{wanted}" is not a row of "{}"',
  "No hay ninguna fila titulada «{wanted}» en «{}»": 'No row is titled "{wanted}" in "{}"',
  "Hay varias filas tituladas «{wanted}» (ids: {}). Usa el id":
    'Several rows are titled "{wanted}" (ids: {}). Use the id',
  "Cada fila debe ser su id o su título": "Each row must be its id or its title",
  "Falta «propiedad» dentro de «donde»": '"propiedad" is missing inside "donde"',
  "Indica qué filas cambiar: «filas» (ids o títulos), «donde» ({propiedad, valor}) o «todas»: true":
    'Say which rows to change: "filas" (ids or titles), "donde" ({propiedad, valor}) or "todas": true',
  "Son {} filas y el máximo de una vez es {MAX_BULK_ROWS}":
    "That's {} rows and the maximum at once is {MAX_BULK_ROWS}",
  "Tipo no válido: usa texto, número, fecha, selección, etiquetas, lugar o casilla":
    "Invalid type: use text, number, date, select, tags, place or checkbox",
  "Falta «tipo»": '"tipo" is missing',
  "Las relaciones no se crean desde el asistente": "Relations can't be created from the assistant",
  "«{}» ya es de tipo {}": '"{}" is already of type {}',
  "Ninguna opción de «{}» ({}) se entiende como «hecho». Indica en «marcadas» cuáles deben quedar marcadas":
    'No option of "{}" ({}) reads as "done". Say in "marcadas" which ones should be checked',
  "Falta «consulta»": '"consulta" is missing',
  "Falta «id»": '"id" is missing',
  "No existe la herramienta «{other}»": 'The tool "{other}" doesn\'t exist',
  "Ollama respondió sin mensaje": "Ollama answered without a message",
  "El servicio online respondió sin mensaje": "The online service answered without a message",
  "La IA está desactivada": "The AI is turned off",
  "Fecha no válida": "Invalid date",
  "Conversación no válida": "Invalid conversation",
  "Mensaje vacío o demasiado largo": "The message is empty or too long",
  "La imagen no es un PNG válido": "The image is not a valid PNG",
  "La imagen es demasiado grande": "The image is too large",
  "No se ha podido leer ningún texto: escribe más grande o con más contraste e inténtalo de nuevo":
    "No text could be read: write larger or with more contrast and try again",
  "Petición de escritura no válida": "Invalid writing request",
  "El texto es demasiado largo para la IA (prueba con menos)":
    "The text is too long for the AI (try with less)",
  "Petición no válida": "Invalid request",
  "Se cortó la respuesta de la IA: {e}": "The AI's answer was cut off: {e}",
  "no update is available": "no update is available",
  "El archivo supera el límite de {} MB": "The file exceeds the limit of {} MB",
  "Referencia de archivo no válida": "Invalid file reference",
  "El archivo ya no existe": "The file no longer exists",
  "Por seguridad este tipo de archivo no se abre desde la app; usa «Guardar como…»":
    'For safety this kind of file isn\'t opened from the app; use "Save as…"',
  "La URL es demasiado larga": "The URL is too long",
  "La URL no es válida": "The URL isn't valid",
  "Solo se admiten URLs http o https": "Only http or https URLs are accepted",
  "El servidor respondió con el error {}": "The server answered with the error {}",
  "No se pudo conectar (sin red, dirección inexistente o tiempo de espera agotado)":
    "Couldn't connect (no network, nonexistent address or timeout)",
  "La URL no apunta a un archivo de tipo {kind} (el servidor devuelve «{ct}»)":
    'The URL doesn\'t point to a file of type {kind} (the server returns "{ct}")',
  "Tipo de adjunto desconocido": "Unknown attachment type",
  "{what} necesita un nombre": "{what} needs a name",
  "El nombre no puede pasar de {MAX_NAME} caracteres":
    "The name can't be longer than {MAX_NAME} characters",
  "El tablero no existe": "The board doesn't exist",
  "La lista no existe": "The list doesn't exist",
  "La tarjeta no existe": "The card doesn't exist",
  "Una tarjeta solo se mueve dentro de su tablero (arrastra la tarea para añadirla a otro)":
    "A card only moves inside its board (drag the task to add it to another)",
  "Solo las tareas pueden estar en un tablero": "Only tasks can be on a board",
  "Esa tarea ya está en este tablero": "That task is already on this board",
  "El tablero no tiene ninguna lista": "The board has no list",
  "{what} no puede pasar de {max} caracteres": "{what} can't be longer than {max} characters",
  "«Cada» tiene que estar entre 1 y {MAX_INTERVAL}": '"Every" must be between 1 and {MAX_INTERVAL}',
  "Los días de la semana van de 0 (lunes) a 6 (domingo)":
    "Days of the week go from 0 (Monday) to 6 (Sunday)",
  "«El n-ésimo día de la semana» solo vale en una repetición mensual o anual (1.º–4.º o el último)":
    '"The nth weekday" only works in a monthly or yearly repetition (1st–4th or the last)',
  "«El último día del mes» no se combina con «el n-ésimo día de la semana»":
    '"The last day of the month" can\'t be combined with "the nth weekday"',
  "«El n-ésimo día de la semana» necesita exactamente un día de la semana":
    '"The nth weekday" needs exactly one day of the week',
  "Los días de la semana solo valen en una repetición semanal (o mensual y anual con «el n-ésimo»)":
    'Days of the week only work in a weekly repetition (or monthly and yearly with "the nth")',
  "«El último día del mes» solo vale en una repetición mensual":
    '"The last day of the month" only works in a monthly repetition',
  "Una repetición termina en una fecha o tras un número de veces, no las dos":
    "A repetition ends on a date or after a number of times, not both",
  "La fecha en que termina la repetición no es válida o es anterior al inicio":
    "The date the repetition ends on isn't valid or is before the start",
  "El número de repeticiones tiene que estar entre 1 y {MAX_COUNT}":
    "The number of repetitions must be between 1 and {MAX_COUNT}",
  "La tarea no existe": "The task doesn't exist",
  "Una cita necesita un título": "An event needs a title",
  "Las fechas no son válidas (AAAA-MM-DD)": "The dates aren't valid (YYYY-MM-DD)",
  "El fin no puede ser anterior al inicio": "The end can't be before the start",
  "Una entrada de día completo no puede pasar de {MAX_DAYS} días":
    "An all-day entry can't be longer than {MAX_DAYS} days",
  "La hora de inicio no es válida": "The start time isn't valid",
  "El fin tiene que ser posterior al inicio": "The end must be after the start",
  "Una entrada no puede pasar de {MAX_DAYS} días": "An entry can't be longer than {MAX_DAYS} days",
  "La entrada no existe": "The entry doesn't exist",
  "Una tarea admite como mucho {MAX_PER_TASK} entradas en el calendario":
    "A task allows at most {MAX_PER_TASK} calendar entries",
  "La ocurrencia no es una fecha válida": "The occurrence isn't a valid date",
  "Esa ocurrencia no existe": "That occurrence doesn't exist",
  "Falta la ocurrencia que se edita": "The occurrence being edited is missing",
  "Falta la ocurrencia que se borra": "The occurrence being deleted is missing",
  "Se pueden cambiar como mucho {MAX_BATCH} citas a la vez":
    "At most {MAX_BATCH} events can be changed at once",
  "Se pueden crear como mucho {MAX_BATCH} citas a la vez":
    "At most {MAX_BATCH} events can be created at once",
  "Se pueden borrar como mucho {MAX_BATCH} citas a la vez":
    "At most {MAX_BATCH} events can be deleted at once",
  "El intervalo pedido no es válido": "The requested interval isn't valid",
  "La entrada ya es una tarea": "The entry is already a task",
  "La entrada no es una tarea": "The entry isn't a task",
  "Solo una tarea tiene lista de comprobación": "Only a task has a checklist",
  "Ese elemento de la lista ya no existe": "That list item no longer exists",
  "La lista está mal formada": "The list is malformed",
  "No se pudo guardar el archivo: {e}": "Couldn't save the file: {e}",
  "Se esperaba el contenido del archivo como bytes": "The file's content was expected as bytes",
  "Fecha no válida: {start}": "Invalid date: {start}",
  "Fecha de fin no válida: {end}": "Invalid end date: {end}",
  "La fecha de fin no puede ser anterior a la de inicio":
    "The end date can't be before the start date",
  "El lugar debe ser un objeto {name, lat, lng}": "The place must be an object {name, lat, lng}",
  "Campo desconocido en el lugar: {unknown}": "Unknown field in the place: {unknown}",
  "El nombre del lugar no puede pasar de {MAX_PLACE_NAME} caracteres":
    "The place name can't be longer than {MAX_PLACE_NAME} characters",
  "{key} debe ser un número entre -{limit} y {limit}":
    "{key} must be a number between -{limit} and {limit}",
  "Las opciones deben ser una lista": "The options must be a list",
  "Máximo {MAX_OPTIONS} opciones": "At most {MAX_OPTIONS} options",
  "Cada opción debe ser texto": "Each option must be text",
  "Opción repetida: {name}": "Repeated option: {name}",
  "La propiedad no existe": "The property doesn't exist",
  "Formato de texto desconocido (url, email o phone)": "Unknown text format (url, email or phone)",
  "No es {what} válido": "It isn't a valid {what}",
  "Una relación necesita una base de datos de destino": "A relation needs a target database",
  "La base de datos de destino no existe": "The target database doesn't exist",
  "Tipo de propiedad desconocido: {kind}": "Unknown property type: {kind}",
  "Máximo {MAX_PROPERTIES} propiedades por base de datos":
    "At most {MAX_PROPERTIES} properties per database",
  "Solo las propiedades de selección y de etiquetas tienen opciones":
    "Only select and tags properties have options",
  "La opción no existe": "The option doesn't exist",
  "Opción repetida: {new}": "Repeated option: {new}",
  "Icono no válido": "Invalid icon",
  "Solo las propiedades de estado tienen grupos": "Only status properties have groups",
  "El orden debe incluir cada propiedad exactamente una vez":
    "The order must include each property exactly once",
  "El orden debe incluir cada fila exactamente una vez":
    "The order must include each row exactly once",
  "La página no existe": "The page doesn't exist",
  "Solo se pueden duplicar las filas de una base de datos":
    "Only the rows of a database can be duplicated",
  "La base de datos no existe": "The database doesn't exist",
  "El texto no puede pasar de {MAX_TEXT} caracteres":
    "The text can't be longer than {MAX_TEXT} characters",
  "El valor debe ser un número": "The value must be a number",
  "La opción debe ser texto": "The option must be text",
  "«{s}» no es una opción de esta propiedad": '"{s}" is not an option of this property',
  "Las etiquetas deben ser una lista": "The tags must be a list",
  "«{tag}» no es una etiqueta de esta propiedad": '"{tag}" is not a tag of this property',
  "Máximo {MAX_TAGS} etiquetas por celda": "At most {MAX_TAGS} tags per cell",
  "Tipo de propiedad no soportado": "Unsupported property type",
  "La página no es una fila de esta base de datos": "The page isn't a row of this database",
  "Cada relación debe ser un id de página": "Each relation must be a page id",
  "Una relación debe ser una lista de páginas": "A relation must be a list of pages",
  "Máximo {MAX_RELATIONS} relaciones por celda": "At most {MAX_RELATIONS} relations per cell",
  "La relación no tiene destino": "The relation has no target",
  "Solo se pueden relacionar filas de la base de datos de destino":
    "Only rows of the target database can be related",
  "Las relaciones no se cambian en bloque": "Relations can't be changed in bulk",
  "Portada no válida": "Invalid cover",
  "La página no es una fila de una base de datos": "The page isn't a row of a database",
  "La página es demasiado grande": "The page is too large",
  "El bloque sincronizado es demasiado grande": "The synced block is too large",
  "Las familias se agrupan por una columna de selección, etiquetas o relación":
    "Families are grouped by a select, tags or relation column",
  "Las familias solo se miden con una columna numérica":
    "Families are only measured with a numeric column",
  "No se pudo deshacer: {e}": "Couldn't undo: {e}",
  "La respuesta es demasiado grande": "The response is too large",
  "Mosaico fuera de rango": "Tile out of range",
  "El servidor no devolvió una imagen": "The server didn't return an image",
  "La búsqueda debe tener entre 1 y {MAX_QUERY_CHARS} caracteres":
    "The search must be between 1 and {MAX_QUERY_CHARS} characters",
  "La antelación del aviso no es válida": "The alert lead time isn't valid",
  "Este sistema no ofrece un almacén de credenciales": "This system has no credential store",
  "La base de datos no se creó": "The database wasn't created",
  "La tarea necesita un título": "The task needs a title",
  "Solo se pueden enlazar páginas a una tarea": "Only pages can be linked to a task",
  "Solo se pueden enlazar páginas normales (no bases de datos ni filas)":
    "Only normal pages can be linked (not databases or rows)",
  "Una tarea admite como mucho {MAX_LINKS_PER_TASK} páginas enlazadas":
    "A task allows at most {MAX_LINKS_PER_TASK} linked pages",
  "La base de tareas no se puede borrar: el Gestor la necesita (sí puedes borrar sus tareas)":
    "The tasks database can't be deleted: the Manager needs it (you can delete its tasks)",
  "Ya no está en la papelera": "It's no longer in the trash",
  "No se puede restaurar: la base de datos a la que pertenecía ya no existe":
    "Can't restore: the database it belonged to no longer exists",
  "El valor del filtro no es válido para una propiedad de tipo {kind}":
    "The filter value isn't valid for a property of type {kind}",
  "Configuración de vista no válida: {e}": "Invalid view settings: {e}",
  "Máximo {MAX_SORTS} reglas de orden": "At most {MAX_SORTS} sort rules",
  "Se ordena por una propiedad que no existe": "Sorting by a property that doesn't exist",
  "Máximo {MAX_FILTERS} filtros": "At most {MAX_FILTERS} filters",
  "Se filtra por una propiedad que no existe": "Filtering by a property that doesn't exist",
  "El operador {:?} no se puede usar con una propiedad de tipo {kind}":
    "The operator {:?} can't be used with a property of type {kind}",
  "Este operador no lleva valor": "This operator takes no value",
  "No se puede agrupar por esa propiedad": "Can't group by that property",
  "La granularidad solo se aplica a fechas": "Granularity only applies to dates",
  "Un tablero solo se puede agrupar por una propiedad de selección":
    "A board can only be grouped by a select property",
  "Solo el calendario y el cronograma usan una propiedad de fecha":
    "Only the calendar and the timeline use a date property",
  "La vista necesita una propiedad de tipo fecha": "The view needs a date property",
  "Solo un gráfico tiene configuración de gráfico": "Only a chart has chart settings",
  "Un gráfico solo suma, promedia o compara propiedades numéricas":
    "A chart only sums, averages or compares numeric properties",
  "Elige la propiedad numérica que se calcula": "Choose the numeric property to calculate",
  "Solo un panel de control tiene widgets": "Only a dashboard has widgets",
  "Un panel de control puede tener como máximo {MAX_WIDGETS} widgets":
    "A dashboard can have at most {MAX_WIDGETS} widgets",
  "Cada widget necesita un id único": "Each widget needs a unique id",
  "Solo un formulario tiene configuración de formulario": "Only a form has form settings",
  "Solo el mapa usa una propiedad de lugar": "Only the map uses a place property",
  "El mapa necesita una propiedad de tipo lugar": "The map needs a place property",
  "Se oculta una propiedad que no existe": "Hiding a property that doesn't exist",
  "Solo una tabla tiene cálculos por columna": "Only a table has per-column calculations",
  "Se calcula una columna que no existe": "Calculating a column that doesn't exist",
  "Ese cálculo solo vale para números": "That calculation only works for numbers",
  "Ese cálculo solo vale para fechas": "That calculation only works for dates",
  "Solo una tabla puede fijar columnas": "Only a table can pin columns",
  "Se fija una columna que no existe": "Pinning a column that doesn't exist",
  "Solo una tabla ajusta el contenido de sus columnas":
    "Only a table fits the content of its columns",
  "Lista de columnas ajustadas no válida": "Invalid list of fitted columns",
  "Se ajusta una columna que no existe": "Fitting a column that doesn't exist",
  "Solo una tabla tiene anchos de columna": "Only a table has column widths",
  "Demasiados anchos de columna": "Too many column widths",
  "Ancho de una columna que no existe": "Width of a column that doesn't exist",
  "El ancho de columna va de {MIN_COLUMN_WIDTH} a {MAX_COLUMN_WIDTH} px":
    "Column width goes from {MIN_COLUMN_WIDTH} to {MAX_COLUMN_WIDTH} px",
  "Un formulario puede tener como máximo {MAX_FORM_FIELDS} campos":
    "A form can have at most {MAX_FORM_FIELDS} fields",
  "El formulario pide una propiedad que no existe":
    "The form asks for a property that doesn't exist",
  "Un campo no puede aparecer dos veces en el formulario": "A field can't appear twice in the form",
  "La vista no existe": "The view doesn't exist",
  "Tipo de vista desconocido: {kind}": "Unknown view type: {kind}",
  "Máximo {MAX_VIEWS} vistas por base de datos": "At most {MAX_VIEWS} views per database",
  "Una base de datos necesita al menos una vista": "A database needs at least one view",
  "Esta vista no es un formulario": "This view isn't a form",
  "El formulario no pide el campo {extra}": "The form doesn't ask for the field {extra}",
  "Falta el campo obligatorio: {name}": "A required field is missing: {name}",
  "El título debe ser texto": "The title must be text",
};
