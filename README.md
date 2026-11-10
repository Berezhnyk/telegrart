# telegrart

A Telegram bot that sends a **pixel-art editor as a message**, using Bot API 10.4 widgets
([`sendWidget`](https://core.telegram.org/bots/api#sendwidget), [widget docs](https://core.telegram.org/bots/widgets)).

Send the bot `/new` and you get a canvas you can paint on right in the chat. Your drawing syncs
to the bot, so it shows up on every device. **➤ Send** has the bot reply with a PNG with transparency.

## Run

```sh
cp .env.example .env   # then put your bot token from @BotFather in it
npm install      # one dependency: terser, which minifies the widget
npm start        # needs Node >= 22.2 and TELEGRAM_API_KEY in .env
npm test         # codec / sync / PNG / size tests
npm run build    # writes dist/widget.html (exact payload) and dist/preview.html
npm run build -- --no-minify   # same, with readable widget JS for debugging in the preview
```

`dist/preview.html` runs the widget on two fake "devices" (dark phone and light desktop) against a fake
bot, so you can work on the UI and sync without Telegram. Open it in a browser.

## Using the canvas

- **Tap** a cell to paint. Horizontal drags paint strokes too. On touch, vertical drags scroll the
  chat, because Telegram gives vertical drags to the chat.
- **Line / rect / oval**: tap the start point, then the end point. With a mouse you get a hover preview.
- **Fill**, **pick** (eyedropper), **erase**. Right-click also erases.
- ↶ ↷ undo/redo · ⇋ mirror · # grid · size cycles 8/16/24/32 · ✕ clear · ➤ Send PNG.

## How it works

The widget can't write its own state. Telegram allows only this:

- The widget calls `TelegramWidget.request(data)` with **≤ 64 bytes**. That's allowed from a tap, or
  once per 5 s in the background in a private chat.
- The bot receives a `widget_query` and replies with `answerWidgetQuery` (≤ 1024 bytes). It changes the
  widget's state with `editMessageWidgetData(chat_data ≤ 1024 bytes)`, which reaches every open copy
  of the message through `chatDataChanged`.

So:

| Piece | What it holds |
|---|---|
| Widget `localStorage` | The working image, including edits not yet synced. Per message, per device. |
| `chat_data` | The canonical image: `A[W]` + 5-bit packed pixels in base64url. A 32×32 canvas is 855 bytes. |
| `data/canvases.json` | The bot's copy of each canvas. The Bot API has no way to read `chat_data` back. |

On each tap the widget diffs its image against the last `chat_data` and sends up to 12 runs
(`idx,len,color`, 5 chars each) per request, throttled to about 1 request/s. Leftover edits go in the
next request. The bot applies the runs, stores the result, pushes it as `chat_data`, and sends the
same string back as the answer. Requests set pixels to absolute values, so retries are safe.

`src/codec.mjs` is shared: the bot imports it, and the build inlines it into the widget, so both
sides always encode the same way.

## Widget limits

Telegram widgets run in a QuickJS sandbox, not a WebView. They have no inputs/selects, keyboard,
network, `getImageData` or `toDataURL`, and no `vh` units. Heights are 50–600 px.

The HTML must be **≤ 32 KB raw and ≤ 4096 bytes after zlib -9**. The build wraps the widget script
in a function and minifies it with terser, which brings it to about 3.7 KB compressed (4.0 KB without
minification). The bot refuses to start, and `npm run build` fails, if the widget goes over.

In production, widgets work only in a **private chat with the bot**. Groups, forwarding and inline
mode are test-server only for now.

## Files

- `bot.mjs`: long-polling bot (`/start`, `/new`, widget queries, PNG export)
- `templates/pixelart.widget.html`: the widget (a port of `templates/pixelart.html`, the standalone browser editor)
- `src/codec.mjs`: shared image/sync encoding
- `src/canvas.mjs`: payload validation, apply, PNG encoder
- `src/widget.mjs`: inlines the codec, minifies with terser, squeezes markup, enforces the size limits

## License

Copyright (c) 2026 Ivan Berezhnyk. Released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

You're free to use, study and modify this project for **noncommercial** purposes, such as personal
projects, hobby bots, research and education. If you share it, you must include the license and its
`Required Notice:` line. **Commercial use**, such as paid bots, products or services, requires a separate
license. Contact [Berezhnyk on GitHub](https://github.com/Berezhnyk).
