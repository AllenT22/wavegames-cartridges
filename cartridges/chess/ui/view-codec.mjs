const squareAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const promotionByFlag = Object.freeze({ Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' });
const pieceTypes = Object.freeze({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' });

export function decodeLegalMoves(encoded) {
  if (typeof encoded !== 'string' || encoded.length % 3 !== 0) {
    throw new Error('Invalid Chess legal-move view');
  }
  const moves = [];
  for (let index = 0; index < encoded.length; index += 3) {
    const from = squareAlphabet.indexOf(encoded[index]);
    const to = squareAlphabet.indexOf(encoded[index + 1]);
    const flag = encoded[index + 2];
    if (from < 0 || to < 0 || !'.QRBNEC'.includes(flag)) {
      throw new Error('Invalid Chess legal-move view');
    }
    moves.push({
      from,
      to,
      promotion: promotionByFlag[flag] ?? null,
      isEnPassant: flag === 'E',
      isCastle: flag === 'C',
    });
  }
  return moves;
}

export function decodePiece(code) {
  if (code === '.') return null;
  if (typeof code !== 'string' || code.length !== 1 || pieceTypes[code.toLowerCase()] === undefined) {
    throw new Error('Invalid Chess board view');
  }
  const lower = code.toLowerCase();
  return { color: code === lower ? 'black' : 'white', type: pieceTypes[lower] };
}

export function decodeHistory(encoded) {
  if (typeof encoded !== 'string') throw new Error('Invalid Chess history view');
  return encoded === '' ? [] : encoded.split(' ');
}
