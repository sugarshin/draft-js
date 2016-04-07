'use strict';

var BlockMapBuilder = require('./BlockMapBuilder');
var CharacterMetadata = require('./CharacterMetadata');
var ContentBlock = require('./ContentBlock');
var DraftModifier = require('./DraftModifier');
var EditorState = require('./EditorState');
var Immutable = require('immutable');

var generateRandomKey = require('./generateRandomKey');

var List = Immutable.List;
var Repeat = Immutable.Repeat;

var BlockUtils = {
  insertBlock: function insertBlock(editorState, entityKey, character) {
    var contentState = editorState.getCurrentContent();
    var selectionState = editorState.getSelection();

    var afterRemoval = DraftModifier.removeRange(contentState, selectionState, 'backward');

    var targetSelection = afterRemoval.getSelectionAfter();
    var afterSplit = DraftModifier.splitBlock(afterRemoval, targetSelection);
    var insertionTarget = afterSplit.getSelectionAfter();

    var asBlock = DraftModifier.setBlockType(afterSplit, insertionTarget, 'unstyled');

    var charData = CharacterMetadata.create({ entity: entityKey });

    var fragmentArray = [new ContentBlock({
      key: generateRandomKey(),
      type: 'unstyled',
      text: character,
      characterList: List(Repeat(charData, character.length))
    }), new ContentBlock({
      key: generateRandomKey(),
      type: 'unstyled',
      text: '',
      characterList: List()
    })];

    var fragment = BlockMapBuilder.createFromArray(fragmentArray);

    var withBlock = DraftModifier.replaceWithFragment(asBlock, insertionTarget, fragment);

    var newContent = withBlock.merge({
      selectionBefore: selectionState,
      selectionAfter: withBlock.getSelectionAfter().set('hasFocus', true)
    });

    return EditorState.push(editorState, newContent, 'insert-fragment');
  }
};

module.exports = BlockUtils;