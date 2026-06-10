# Catálogo Geek Store

Este repositorio publica `productos.json`, el catálogo de la tienda
sincronizado desde Alegra cada 30 minutos por GitHub Actions.
Solo contiene información pública: nombre, precio, stock e imágenes
de los artículos disponibles (lo mismo que muestra la tienda).

La tienda en Netlify lo lee desde:
`https://raw.githubusercontent.com/USUARIO/geekstore-catalogo/main/productos.json`
