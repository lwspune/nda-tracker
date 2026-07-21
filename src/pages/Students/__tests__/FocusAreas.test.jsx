import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FocusAreas from '../FocusAreas'

describe('FocusAreas', () => {
  it('renders nothing when both lists are empty', () => {
    const { container } = render(<FocusAreas startHere={[]} readyToLearn={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a labelled Learn link and Practice link per start-here chapter', () => {
    const startHere = [
      {
        chapter: 'Vectors',
        from: [],
        learnUrl: 'https://www.pyqvault.com/go/learn?chapter=Vectors',
        practiceUrl: 'https://www.pyqvault.com/go/practice?subject=Maths&chapter=Vectors&exam=NDA',
      },
    ]
    render(<FocusAreas startHere={startHere} readyToLearn={[]} />)

    const learn = screen.getByRole('link', { name: 'Learn Vectors' })
    expect(learn).toHaveAttribute('href', startHere[0].learnUrl)
    expect(learn).toHaveAttribute('target', '_blank')
    expect(learn).toHaveAttribute('rel', 'noopener noreferrer')

    const practice = screen.getByRole('link', { name: 'Practice Vectors' })
    expect(practice).toHaveAttribute('href', startHere[0].practiceUrl)
  })

  it('shows Learn but not Practice when the chapter has no practice bank', () => {
    const startHere = [
      { chapter: 'Sets & Relations', from: ['Probability'], learnUrl: 'https://www.pyqvault.com/go/learn?chapter=Sets+%26+Relations', practiceUrl: null },
    ]
    render(<FocusAreas startHere={startHere} readyToLearn={[]} />)
    expect(screen.getByRole('link', { name: 'Learn Sets & Relations' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Practice Sets & Relations' })).toBeNull()
  })

  it('renders the ready-to-learn frontier (max 6)', () => {
    render(<FocusAreas startHere={[]} readyToLearn={['Complex Numbers', 'Lines']} />)
    expect(screen.getByText(/Complex Numbers · Lines/)).toBeInTheDocument()
  })
})
