// The card is drawn into somebody else's page. A script on that page can call
// element.click() or dispatch a synthetic MouseEvent on anything it can reach,
// and every button on the card ends in a message to the background: scan, mute,
// snooze, turn alerts off. A synthetic event carries isTrusted = false, and
// only the browser itself, acting on a real click or key press, sets it true.
// The handlers that send a message are wrapped in this so a page cannot press
// them on the user's behalf.
//
// Its own module, free of lit-html and the browser polyfill, so the rule is a
// unit test and not only a comment.

export function onlyTrusted(handler: () => void): (event: Event) => void {
  return (event) => {
    if (event.isTrusted) handler();
  };
}
