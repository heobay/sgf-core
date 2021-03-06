// depends on util.js, board.js
go.SGF = function() {
    this.size = 19;
    this.root_move = null;
    this.white_player = "White";
    this.black_player = "Black";
    this.handicap = 0;
    this.ruleset = "Japanese";
    this.komi = 0;
}

go.SGF.prototype.getBlankBoard = function() {
    return new go.Board(this.size);
}

go.Move = function() {
    this.sgf = null;
    this.position = null;
    this.color = null;
    this.previous_move = null;
    this.comment = "";
    this.labels = [];
    this.triangles = [];
    this.circles = [];
    this.squares = [];
    this.x_marks = [];
    this._next_moves = [];
    this._static_white = [];
    this._static_black = [];
    this._static_empty = [];
    this._cached_serialized_board = null;
}

go.Move.prototype.addNextMove = function(next_mv) {
    this._next_moves.push(next_mv);
    next_mv.previous_move = this;
}

go.Move.prototype.getBoard = function() {
    var board;
    if (this._cached_serialized_board) {
        board = this.sgf.getBlankBoard();
        board.deserialize(this._cached_serialized_board);
        return board;
    } else {
        if (this.previous_move) {
            board = this.previous_move.getBoard();
        } else {
            board = this.sgf.getBlankBoard();
        }

        this.applyToBoard(board)
        this._cached_serialized_board = board.serialize();
        return board;
    }
}

go.Move.prototype.applyToBoard = function(board) {
    var quiet_remove = go.partial(board.removeStoneBySgf, [undefined, true], board),
        quiet_add_black = go.partial(board.addStoneBySgf, [undefined, 'b', true], board),
        quiet_add_white = go.partial(board.addStoneBySgf, [undefined, 'w', true], board);
    this._static_empty.forEach(quiet_remove);
    this._static_black.forEach(quiet_add_black);
    this._static_white.forEach(quiet_add_white);
    if (this.position) {
        board.addStoneBySgf(this.position, this.color, true);
    }
    board.changed();
}

// Brute force tokenize SGFs
// Matches: "(", ")", ";", "\w", "[.*]"
// For "[.*]", "]" can be escaped by "\]"
go.tokenizeSgfData = function(sgf_data) {
    var current_token = "",
        tokens = [],
        in_value = false,
        escaping = false,
        tree_token = /[\(\);]/,
        open_paren = 0,
        close_paren = 0,
        current_char;
    for (var i = 0; i < sgf_data.length; i++) {
        current_char = sgf_data.charAt(i);
        if (in_value) {
            if (!escaping && current_char === "\\") {
                escaping = true;
            } else {
                current_token += current_char;
                if (!escaping && current_char === "]") {
                    in_value = false;
                    tokens.push(current_token);
                    current_token = "";
                }
                escaping = false;
            }
        } else {
            if (current_char.match(tree_token) || current_char.match(/\s/)) {
                if (current_token) {
                    tokens.push(current_token);
                    current_token = "";
                }
                if (current_char === ")") {
                    close_paren += 1;
                }
                if (current_char === "(") {
                    open_paren += 1;
                }
                if (close_paren > open_paren) {
                    throw "Unmatched \")\"!";
                }
                if (current_char.trim()) {
                    tokens.push(current_char);
                }
            } else if (current_char.match(/\w/)){
                current_token += current_char;
            } else if (current_char === "[") {
                current_token += current_char;
                in_value = true;
            }
        }
    }
    if (in_value || current_token || open_paren - close_paren !== 0) {
        throw "Invalid SGF data!";
    }
    return tokens;
}

go.parseMethodValue = function(token) {
    var valid_token = /^(\w*)\[(.*)\]$/,
        mv_match = token.match(valid_token);
    if (mv_match && mv_match.length == 3) {
        return mv_match.slice(1);
    } else {
        throw "Broken token \"" + token + "\"!";
    }
}

go.parseSgfData = function(sgf_data) {
    var sgf_tokens = go.tokenizeSgfData(sgf_data),
        variation_stack = [],
        sgf = new go.SGF(),
        token, last_mv, cur_mv,
        method, value, method_value;
    for (var i = 0; i < sgf_tokens.length; i++) {
        token = sgf_tokens[i];
        if (token === "(") {
            if (last_mv) {
                variation_stack.push(cur_mv);
            }
        } else if (token === ")") {
            if (variation_stack.length > 0) {
                cur_mv = variation_stack.pop();
            }
        } else if (token === ";") {
            last_mv = cur_mv;
            cur_mv = new go.Move();
            cur_mv.sgf = sgf;
            if (sgf.root_move === null) {
                sgf.root_move = cur_mv;
            }
            if (last_mv) {
                last_mv.addNextMove(cur_mv);
            }
        } else {
            method_value = go.parseMethodValue(token);
            method = method_value[0] || method;
            value = method_value[1];

            // full spec at http://www.red-bean.com/sgf/properties.html
            if (method === "B" || method === "W") {
                cur_mv.color = method.toLowerCase();
                cur_mv.position = value;
            } else if (method === "C") {
                cur_mv.comment = value;
            } else if (method === "AB") {
                cur_mv._static_black.push(value);
            } else if (method === "AW") {
                cur_mv._static_white.push(value);
            } else if (method === "AE") {
                cur_mv._static_empty.push(value);
            } else if (method === "TR") {
                cur_mv.triangles.push(value);
            } else if (method === "SQ") {
                cur_mv.squares.push(value);
            } else if (method === "CR") {
                cur_mv.circles.push(value);
            } else if (method === "MA") {
                cur_mv.x_marks.push(value);
            } else if (method === "LB") {
                cur_mv.labels.push(value);
            } else if (method === "SZ") {
                sgf.size = parseInt(value);
            } else if (method === "FF") {
                if (value !== "4") {
                    go.warn("File format 4 explicitly supported - YMMV with other formats.");
                }
            } else if (method === "GM") {
                if (value !== "1") {
                    throw "SGF type is not Go!";
                }
            } else if (method === "ST") {
                // variation mode, not supported
                // TODO support this maybe
            } else if (method === "CA") {
                // charset
            } else if (method === "RU") {
                sgf.ruleset = value
            } else if (method === "PW") {
                sgf.white_player = value;
            } else if (method === "PB") {
                sgf.black_player = value;
            } else if (method === "HA") {
                sgf.handicap = value
            } else if (method === "KM") {
                sgf.komi = value
            } else if (method === "TM") {
                // time limit
            } else if (method === "OT") {
                // overtime system
            } else if (method === "RE") {
                //results
            } else if (method === "GN") {
                // game name
            } else if (method === "BT") {
                // black team
            } else if (method === "WT") {
                // white team
            } else if (method === "BR") {
                // black rank
            } else if (method === "WR") {
                // white rank
            } else if (method === "AN") {
                // person annotating
            } else if (method === "AP") {
                // application
            } else if (method === "CP") {
                // copyright
            } else if (method === "EV") {
                // event
            } else if (method === "DT") {
                // date
            } else {
                go.warn("Warning: Unrecognized method \"" + method + "\"!");
            }
        }
    }
    return sgf;
}
