import { useState } from 'react';
import { WithContext as ReactTags } from 'react-tag-input';

const KeyCodes = { comma: 188, enter: 13 };
const delimiters = [KeyCodes.comma, KeyCodes.enter];

export default function Tags({ onTagsChange }) {
  const [tags, setTags] = useState([]);

  const handleDelete = (i: number) => {
    const newTags = tags.filter((tag, index) => index !== i);
    setTags(newTags);
    handleChange(newTags);
  };

  const handleAddition = (tag: { id: string; text: string }) => {
    const newTags = [...tags, tag]; 
    setTags(newTags);
    handleChange(newTags);
  };

  const handleDrag = (tag: { id: string; text: string }, currPos: number, newPos: number) => {
    const newTags = tags.slice();
    newTags.splice(currPos, 1);
    newTags.splice(newPos, 0, tag);
    setTags(newTags);
    handleChange(newTags);
  };

  const handleChange = (tags: {}[]) => {
    var tagList = tags.map(function(tag) { return tag["text"]; }).toString();
    onTagsChange(tagList);
  };

  return (
    <ReactTags
      tags={tags}
      suggestions={[]}
      delimiters={delimiters}
      handleDelete={handleDelete}
      handleAddition={handleAddition}
      handleDrag={handleDrag}
      placeholder='add up to 3 tags'
      maxLength={40}
      classNames={tags.length == 3 ? { tagInput: 'makeMeInvisible' } : undefined}
    />
  );
}
