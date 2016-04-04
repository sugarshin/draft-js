/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule MediaUtils
 * @typechecks
 * 
 */

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

var MediaUtils = {
  insertMedia: function insertMedia(editorState, entityKey, character) {
    var contentState = editorState.getCurrentContent();
    var selectionState = editorState.getSelection();

    var afterRemoval = DraftModifier.removeRange(contentState, selectionState, 'backward');

    var targetSelection = afterRemoval.getSelectionAfter();
    var afterSplit = DraftModifier.splitBlock(afterRemoval, targetSelection);
    var insertionTarget = afterSplit.getSelectionAfter();

    var asMedia = DraftModifier.setBlockType(afterSplit, insertionTarget, 'media');

    var charData = CharacterMetadata.create({ entity: entityKey });

    var fragmentArray = [new ContentBlock({
      key: generateRandomKey(),
      type: 'media',
      text: character,
      characterList: List(Repeat(charData, character.length))
    }), new ContentBlock({
      key: generateRandomKey(),
      type: 'unstyled',
      text: '',
      characterList: List()
    })];

    var fragment = BlockMapBuilder.createFromArray(fragmentArray);

    var withMedia = DraftModifier.replaceWithFragment(asMedia, insertionTarget, fragment);

    var newContent = withMedia.merge({
      selectionBefore: selectionState,
      selectionAfter: withMedia.getSelectionAfter().set('hasFocus', true)
    });

    return EditorState.push(editorState, newContent, 'insert-fragment');
  }
};

module.exports = MediaUtils;